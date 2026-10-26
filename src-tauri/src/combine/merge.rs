//! Ghép các tài liệu PDF thành một bằng lopdf: đánh số lại đối tượng, dựng cây trang mới và mục lục (dấu trang).

use std::collections::BTreeMap;

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId};

use super::CombineError;

/// Các thuộc tính trang có thể thừa kế từ nút cha trong cây trang.
const INHERITED: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

pub fn load(path: &std::path::Path) -> Result<Document, String> {
    let mut doc = Document::load(path).map_err(|e| format!("không đọc được PDF ({e})"))?;
    if doc.is_encrypted() {
        doc.decrypt("").map_err(|_| "file có mật khẩu, hãy mở khoá trước khi gộp".to_string())?;
    }
    if doc.get_pages().is_empty() {
        return Err("file PDF không có trang nào".into());
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

/// `titles[i]` là tiêu đề dấu trang trỏ tới trang đầu của tài liệu thứ i (None = không tạo).
pub fn merge(docs: Vec<Document>, titles: &[Option<&str>]) -> Result<Document, CombineError> {
    let mut out = Document::with_version("1.7");
    let mut objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut page_ids: Vec<ObjectId> = Vec::new();
    let mut first_page_of: Vec<Option<ObjectId>> = Vec::new();
    let mut next_id = 1;

    for mut doc in docs {
        materialize_inherited(&mut doc);
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id + 1;
        let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        first_page_of.push(pages.first().copied());
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
    let entries: Vec<(&str, ObjectId)> = titles
        .iter()
        .zip(&first_page_of)
        .filter_map(|(t, p)| Some(((*t)?, (*p)?)))
        .collect();
    if let Some(outlines) = build_outlines(&mut out, &entries) {
        catalog.set("Outlines", outlines);
        catalog.set("PageMode", "UseOutlines");
    }
    out.objects.insert(catalog_id, Object::Dictionary(catalog));
    out.trailer.set("Root", catalog_id);
    out.prune_objects();
    Ok(out)
}

/// Dựng mục lục phẳng: mỗi file một dấu trang trỏ tới trang đầu của nó.
fn build_outlines(doc: &mut Document, entries: &[(&str, ObjectId)]) -> Option<ObjectId> {
    if entries.is_empty() { return None; }
    let root = doc.new_object_id();
    let ids: Vec<ObjectId> = entries.iter().map(|_| doc.new_object_id()).collect();
    for (i, ((title, page), id)) in entries.iter().zip(&ids).enumerate() {
        let mut d: Dictionary = dictionary! {
            "Title" => lopdf::text_string(title),
            "Parent" => root,
            "Dest" => vec![Object::Reference(*page), "Fit".into()],
        };
        if i > 0 { d.set("Prev", ids[i - 1]); }
        if i + 1 < ids.len() { d.set("Next", ids[i + 1]); }
        doc.objects.insert(*id, Object::Dictionary(d));
    }
    doc.objects.insert(
        root,
        Object::Dictionary(dictionary! {
            "Type" => "Outlines",
            "First" => ids[0],
            "Last" => *ids.last().unwrap(),
            "Count" => ids.len() as i64,
        }),
    );
    Some(root)
}
