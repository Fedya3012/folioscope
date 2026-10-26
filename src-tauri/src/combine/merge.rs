//! Ghép các tài liệu PDF thành một bằng lopdf: đánh số lại đối tượng, dựng cây trang mới và mục lục (dấu trang).

use std::collections::BTreeMap;

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId};

use super::CombineError;

/// Các thuộc tính trang có thể thừa kế từ nút cha trong cây trang.
const INHERITED: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

/// Lý do không nạp được một PDF. Giao diện dựa vào `needs_password` để hiện ô nhập mật khẩu ngay trong hàng.
#[derive(Debug)]
pub enum LoadError {
    /// File có mật khẩu: `wrong` là đã thử một mật khẩu mà không đúng.
    Password { wrong: bool },
    Other(String),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::Password { wrong: false } => write!(f, "file có mật khẩu, hãy nhập mật khẩu"),
            LoadError::Password { wrong: true } => write!(f, "mật khẩu không đúng"),
            LoadError::Other(s) => write!(f, "{s}"),
        }
    }
}

pub fn load(path: &std::path::Path, password: Option<&str>) -> Result<Document, LoadError> {
    let mut doc = Document::load(path).map_err(|e| LoadError::Other(format!("không đọc được PDF ({e})")))?;
    if doc.is_encrypted() {
        // Thử mật khẩu trống trước: nhiều file chỉ khoá quyền chỉnh sửa, không khoá việc mở.
        let opened = doc.decrypt("").is_ok() && !doc.get_pages().is_empty();
        if !opened {
            // Còn lại để PDFium mở khoá (nó quyết định mật khẩu đúng hay sai) rồi lopdf đọc bản đã bỏ mật khẩu.
            let bytes = crate::pdf::unlock_copy(&path.to_string_lossy(), password.filter(|p| !p.is_empty()))
                .map_err(|e| match e {
                    crate::pdf::PdfError::PasswordRequired => LoadError::Password { wrong: false },
                    crate::pdf::PdfError::WrongPassword => LoadError::Password { wrong: true },
                    other => LoadError::Other(other.to_string()),
                })?;
            doc = Document::load_mem(&bytes).map_err(|e| LoadError::Other(format!("không đọc được PDF ({e})")))?;
        }
    }
    if doc.get_pages().is_empty() {
        return Err(LoadError::Other("file PDF không có trang nào".into()));
    }
    Ok(doc)
}

/// Chép các thuộc tính thừa kế xuống từng trang, vì khi chuyển sang cây trang mới nút cha cũ không còn.
fn materialize_inherited(doc: &mut Document) {
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for id in pages {
        let mut found: BTreeMap<&[u8], Object> = BTreeMap::new();
        let mut cur = id;
        // Giới hạn độ sâu để file hỏng có vòng Parent không treo máy.
        for _ in 0..64 {
            let Ok(d) = doc.get_dictionary(cur) else { break };
            for key in INHERITED {
                if !found.contains_key(key) {
                    if let Ok(v) = d.get(key) { found.insert(key, v.clone()); }
                }
            }
            match d.get(b"Parent").and_then(Object::as_reference) {
                Ok(p) => cur = p,
                Err(_) => break,
            }
        }
        if let Ok(page) = doc.get_dictionary_mut(id) {
            for (k, v) in found {
                if !page.has(k) { page.set(k.to_vec(), v); }
            }
        }
    }
}

/// Các dấu trang cấp cao nhất của một tài liệu, theo thứ tự (đi theo chuỗi First/Next, có chặn vòng lặp).
fn top_outline_items(doc: &Document) -> Vec<ObjectId> {
    let first = doc
        .catalog()
        .and_then(|c| c.get(b"Outlines"))
        .and_then(Object::as_reference)
        .and_then(|root| doc.get_dictionary(root))
        .and_then(|d| d.get(b"First"))
        .and_then(Object::as_reference);
    let mut items = Vec::new();
    let mut cur = first.ok();
    while let Some(id) = cur {
        if items.contains(&id) || items.len() > 50_000 { break; }
        items.push(id);
        cur = doc.get_dictionary(id).and_then(|d| d.get(b"Next")).and_then(Object::as_reference).ok();
    }
    items
}

/// Số dấu trang con cháu của `id` (để ghi Count cho mục chứa).
fn descendants(objects: &BTreeMap<ObjectId, Object>, id: ObjectId, depth: u32) -> i64 {
    if depth > 32 { return 0; }
    let Some(Object::Dictionary(d)) = objects.get(&id) else { return 0 };
    let mut n = 0;
    let mut cur = d.get(b"First").and_then(Object::as_reference).ok();
    let mut guard = 0;
    while let Some(c) = cur {
        guard += 1;
        if guard > 50_000 { break; }
        n += 1 + descendants(objects, c, depth + 1);
        cur = match objects.get(&c) {
            Some(Object::Dictionary(cd)) => cd.get(b"Next").and_then(Object::as_reference).ok(),
            _ => None,
        };
    }
    n
}

/// Dấu trang của một tài liệu nguồn: tiêu đề mới (nếu có), trang đầu và các dấu trang gốc cấp cao nhất.
struct Section {
    title: Option<String>,
    first_page: Option<ObjectId>,
    original: Vec<ObjectId>,
}

/// `titles[i]` là tiêu đề dấu trang trỏ tới trang đầu của tài liệu thứ i (None = không tạo).
/// `keep_original`: giữ dấu trang gốc của từng file, lồng dưới dấu trang của file đó (hoặc ở cấp cao nhất nếu file không có tiêu đề).
/// Đích dạng tên (named destination) không giữ được vì bảng tên của file gốc bị bỏ; các mục đó vẫn hiện nhưng không nhảy.
pub fn merge(docs: Vec<Document>, titles: &[Option<&str>], keep_original: bool) -> Result<Document, CombineError> {
    let mut out = Document::with_version("1.7");
    let mut objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut page_ids: Vec<ObjectId> = Vec::new();
    let mut sections: Vec<Section> = Vec::new();
    let mut next_id = 1;

    for (i, mut doc) in docs.into_iter().enumerate() {
        materialize_inherited(&mut doc);
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id + 1;
        let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        sections.push(Section {
            title: titles.get(i).copied().flatten().map(str::to_string),
            first_page: pages.first().copied(),
            original: if keep_original { top_outline_items(&doc) } else { Vec::new() },
        });
        page_ids.extend(pages);
        objects.extend(doc.objects);
    }

    let pages_id = (next_id, 0);
    let catalog_id = (next_id + 1, 0);
    out.max_id = next_id + 1;

    // Bỏ Catalog/Pages cũ; mọi trang trỏ về nút Pages mới.
    objects.retain(|_, o| !matches!(o.type_name().unwrap_or(b""), b"Catalog" | b"Pages"));
    for id in &page_ids {
        if let Some(Object::Dictionary(d)) = objects.get_mut(id) {
            d.set("Parent", pages_id);
        }
    }
    out.objects = objects;

    out.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().map(|id| Object::Reference(*id)).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );
    let mut catalog = dictionary! { "Type" => "Catalog", "Pages" => pages_id };
    if let Some(outlines) = build_outlines(&mut out, &sections) {
        catalog.set("Outlines", outlines);
        catalog.set("PageMode", "UseOutlines");
    }
    out.objects.insert(catalog_id, Object::Dictionary(catalog));
    out.trailer.set("Root", catalog_id);
    out.prune_objects();
    Ok(out)
}

/// Dựng mục lục: mỗi file có tiêu đề là một dấu trang trỏ tới trang đầu của nó (kèm dấu trang gốc làm con nếu có);
/// file không có tiêu đề thì dấu trang gốc nằm thẳng ở cấp cao nhất.
fn build_outlines(doc: &mut Document, sections: &[Section]) -> Option<ObjectId> {
    let root = doc.new_object_id();
    let mut top: Vec<ObjectId> = Vec::new();
    let mut total = 0i64;
    for sec in sections {
        let inner: i64 = sec.original.iter().map(|id| 1 + descendants(&doc.objects, *id, 0)).sum();
        match (&sec.title, sec.first_page) {
            (Some(title), Some(page)) => {
                let id = doc.new_object_id();
                let mut d: Dictionary = dictionary! {
                    "Title" => lopdf::text_string(title),
                    "Dest" => vec![Object::Reference(page), "Fit".into()],
                };
                if let (Some(first), Some(last)) = (sec.original.first(), sec.original.last()) {
                    d.set("First", *first);
                    d.set("Last", *last);
                    d.set("Count", inner);
                    for child in &sec.original {
                        if let Some(Object::Dictionary(cd)) = doc.objects.get_mut(child) { cd.set("Parent", id); }
                    }
                }
                doc.objects.insert(id, Object::Dictionary(d));
                top.push(id);
                total += 1 + inner;
            }
            _ => {
                top.extend(&sec.original);
                total += inner;
            }
        }
    }
    if top.is_empty() { return None; }
    for (i, id) in top.iter().enumerate() {
        let Some(Object::Dictionary(d)) = doc.objects.get_mut(id) else { continue };
        d.set("Parent", root);
        d.remove(b"Prev");
        d.remove(b"Next");
        if i > 0 { d.set("Prev", top[i - 1]); }
        if i + 1 < top.len() { d.set("Next", top[i + 1]); }
    }
    doc.objects.insert(
        root,
        Object::Dictionary(dictionary! {
            "Type" => "Outlines",
            "First" => top[0],
            "Last" => *top.last().unwrap(),
            "Count" => total,
        }),
    );
    Some(root)
}
