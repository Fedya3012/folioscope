use std::path::{Path, PathBuf};

use lopdf::{dictionary, Document, Object, Stream};

use super::*;

/// PDF thử nghiệm: `n` trang, khổ khai báo ở nút Pages (thừa kế) để kiểm tra việc chép xuống từng trang.
fn make_pdf(path: &Path, n: usize, size: (i64, i64), text: &str) {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
    let mut kids = vec![];
    for i in 0..n {
        let c = format!("BT /F1 24 Tf 50 700 Td ({text} trang {}) Tj ET", i + 1);
        let content = doc.add_object(Stream::new(dictionary! {}, c.into_bytes()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content,
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        });
        kids.push(Object::Reference(page));
    }
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
        "Type" => "Pages", "Kids" => kids, "Count" => n as i64,
        "MediaBox" => vec![0.into(), 0.into(), size.0.into(), size.1.into()],
    }));
    let cat = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", cat);
    doc.save(path).unwrap();
}

fn req(files: Vec<(PathBuf, &str)>, out: PathBuf, bookmarks: bool, compression: Compression) -> CombineRequest {
    CombineRequest {
        files: files.into_iter().map(|(path, t)| InputFile { path, title: t.into(), password: None }).collect(),
        output: out,
        bookmarks,
        keep_bookmarks: false,
        normalize_a4: false,
        compression,
        ocr_images: false,
        ocr_lang: "vie+eng".into(),
    }
}

fn run(r: &CombineRequest) -> Result<CombineResult, CombineError> {
    combine(r, convert::find_office().as_deref(), &CancelFlag::default(), &mut |_| {})
}

#[test]
fn merges_in_order_and_keeps_inherited_page_size() {
    let d = tempdir().unwrap();
    let (a, b, out) = (d.path().join("a.pdf"), d.path().join("b.pdf"), d.path().join("out.pdf"));
    make_pdf(&a, 2, (300, 400), "A");
    make_pdf(&b, 3, (500, 200), "B");
    let res = run(&req(vec![(b.clone(), "B"), (a.clone(), "A")], out.clone(), true, Compression::Balanced)).unwrap();
    assert_eq!(res.pages, 5);
    let doc = Document::load(&out).unwrap();
    let pages = doc.get_pages();
    let sizes: Vec<_> = pages
        .values()
        .map(|id| doc.get_dictionary(*id).unwrap().get(b"MediaBox").unwrap().as_array().unwrap()[2].as_float().unwrap())
        .collect();
    assert_eq!(sizes, vec![500.0, 500.0, 500.0, 300.0, 300.0]); // B trước A
    let text = doc.extract_text(&[1, 4]).unwrap();
    assert!(text.contains("B trang 1") && text.contains("A trang 1"), "{text}");
}

#[test]
fn bookmarks_point_to_first_page_of_each_file() {
    let d = tempdir().unwrap();
    let (a, b, out) = (d.path().join("a.pdf"), d.path().join("b.pdf"), d.path().join("out.pdf"));
    make_pdf(&a, 2, (300, 400), "A");
    make_pdf(&b, 1, (300, 400), "B");
    run(&req(vec![(a, "Hợp đồng"), (b, "Phụ lục")], out.clone(), true, Compression::None)).unwrap();
    let doc = Document::load(&out).unwrap();
    let toc = doc.get_toc().unwrap();
    let got: Vec<_> = toc.toc.iter().map(|t| (t.title.clone(), t.page)).collect();
    assert_eq!(got, vec![("Hợp đồng".to_string(), 1), ("Phụ lục".to_string(), 3)]);
}

#[test]
fn no_bookmarks_when_disabled() {
    let d = tempdir().unwrap();
    let (a, out) = (d.path().join("a.pdf"), d.path().join("out.pdf"));
    make_pdf(&a, 1, (300, 400), "A");
    run(&req(vec![(a, "A")], out.clone(), false, Compression::None)).unwrap();
    let doc = Document::load(&out).unwrap();
    assert!(doc.catalog().unwrap().get(b"Outlines").is_err());
}

#[test]
fn compression_shrinks_file() {
    let d = tempdir().unwrap();
    let a = d.path().join("a.pdf");
    make_pdf(&a, 40, (300, 400), "Nội dung lặp lại lặp lại lặp lại");
    let size = |c, name: &str| {
        let out = d.path().join(name);
        run(&req(vec![(a.clone(), "A")], out.clone(), true, c)).unwrap().bytes
    };
    let (none, balanced) = (size(Compression::None, "n.pdf"), size(Compression::Balanced, "b.pdf"));
    assert!(balanced < none, "{balanced} >= {none}");
}

#[test]
fn rejects_output_equal_to_input_and_empty_list() {
    let d = tempdir().unwrap();
    let a = d.path().join("a.pdf");
    make_pdf(&a, 1, (300, 400), "A");
    assert!(matches!(run(&req(vec![(a.clone(), "A")], a, true, Compression::None)), Err(CombineError::OutputIsInput)));
    assert!(matches!(run(&req(vec![], d.path().join("o.pdf"), true, Compression::None)), Err(CombineError::NoInput)));
}

#[test]
fn bad_file_names_the_culprit_and_leaves_no_output() {
    let d = tempdir().unwrap();
    let (a, bad, out) = (d.path().join("a.pdf"), d.path().join("hong.pdf"), d.path().join("out.pdf"));
    make_pdf(&a, 1, (300, 400), "A");
    std::fs::write(&bad, b"khong phai pdf").unwrap();
    let err = run(&req(vec![(a, "A"), (bad, "H")], out.clone(), true, Compression::None)).unwrap_err();
    assert!(err.to_string().starts_with("hong.pdf:"), "{err}");
    assert!(!out.exists());
}

#[test]
fn cancel_stops_before_writing() {
    let d = tempdir().unwrap();
    let (a, out) = (d.path().join("a.pdf"), d.path().join("out.pdf"));
    make_pdf(&a, 1, (300, 400), "A");
    let cancel = CancelFlag::default();
    cancel.cancel();
    let r = combine(&req(vec![(a, "A")], out.clone(), true, Compression::None), None, &cancel, &mut |_| {});
    assert!(matches!(r, Err(CombineError::Cancelled)));
    assert!(!out.exists());
}

#[test]
fn progress_is_monotonic_and_ends_at_100() {
    let d = tempdir().unwrap();
    let (a, b, out) = (d.path().join("a.pdf"), d.path().join("b.pdf"), d.path().join("out.pdf"));
    make_pdf(&a, 1, (300, 400), "A");
    make_pdf(&b, 1, (300, 400), "B");
    let mut seen = vec![];
    combine(&req(vec![(a, "A"), (b, "B")], out, true, Compression::Max), None, &CancelFlag::default(), &mut |p| seen.push(p.percent)).unwrap();
    assert!(seen.windows(2).all(|w| w[0] <= w[1]), "{seen:?}");
    assert_eq!(*seen.last().unwrap(), 100.0);
}

fn write_test_images(dir: &Path) -> Vec<PathBuf> {
    let rgb = image::RgbImage::from_fn(64, 32, |x, y| image::Rgb([(x * 4) as u8, (y * 8) as u8, 90]));
    let rgba = image::RgbaImage::from_fn(20, 20, |x, _| image::Rgba([200, 30, 30, if x < 10 { 255 } else { 60 }]));
    let (png, jpg, big) = (dir.join("a.png"), dir.join("b.JPG"), dir.join("c.png"));
    rgba.save(&png).unwrap();
    rgb.save(&jpg).unwrap();
    image::RgbImage::new(3000, 1000).save(&big).unwrap();
    vec![png, jpg, big]
}

#[test]
fn images_become_pages_and_big_ones_fit_a4() {
    let d = tempdir().unwrap();
    let imgs = write_test_images(d.path());
    let out = d.path().join("out.pdf");
    let files = imgs.iter().map(|p| (p.clone(), "")).collect();
    let res = run(&req(files, out.clone(), false, Compression::Balanced)).unwrap();
    assert_eq!((res.pages, res.converted), (3, 3));
    let doc = Document::load(&out).unwrap();
    let ids: Vec<_> = doc.get_pages().into_values().collect();
    let mb = |i: usize| -> Vec<f32> {
        doc.get_dictionary(ids[i]).unwrap().get(b"MediaBox").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect()
    };
    assert_eq!(mb(0)[2..], [15.0, 15.0]); // 20 px * 0.75, giữ cỡ gốc
    assert!(mb(2)[2] <= 842.0 && (mb(2)[2] / mb(2)[3] - 3.0).abs() < 0.01); // 3000x1000 vừa khổ ngang, giữ tỉ lệ
}

#[test]
fn max_compression_downsamples_large_jpeg() {
    let d = tempdir().unwrap();
    let jpg = d.path().join("big.jpg");
    image::RgbImage::from_fn(3600, 2400, |x, y| image::Rgb([(x ^ y) as u8, (x / 3) as u8, (y / 2) as u8])).save(&jpg).unwrap();
    let size = |c, n: &str| run(&req(vec![(jpg.clone(), "")], d.path().join(n), false, c)).unwrap().bytes;
    let (bal, max) = (size(Compression::Balanced, "b.pdf"), size(Compression::Max, "m.pdf"));
    assert!(max < bal, "{max} >= {bal}");
}

#[test]
fn office_text_and_html_convert_when_libreoffice_exists() {
    let Some(office) = convert::find_office() else { eprintln!("bỏ qua: không có LibreOffice"); return };
    let d = tempdir().unwrap();
    let (txt, html, out) = (d.path().join("ghi chú.txt"), d.path().join("trang.html"), d.path().join("out.pdf"));
    std::fs::write(&txt, "Xin chào Việt Nam\n").unwrap();
    std::fs::write(&html, "<html><body><h1>Tiêu đề</h1></body></html>").unwrap();
    let r = combine(&req(vec![(txt, "TXT"), (html, "HTML")], out.clone(), true, Compression::Balanced), Some(&office), &CancelFlag::default(), &mut |_| {}).unwrap();
    assert_eq!((r.pages, r.converted), (2, 2));
}

#[test]
fn office_without_libreoffice_explains_what_to_install() {
    let d = tempdir().unwrap();
    let txt = d.path().join("a.txt");
    std::fs::write(&txt, "x").unwrap();
    let err = combine(&req(vec![(txt, "")], d.path().join("o.pdf"), false, Compression::None), None, &CancelFlag::default(), &mut |_| {}).unwrap_err();
    assert!(err.to_string().contains("LibreOffice"), "{err}");
}

#[test]
fn classify_is_case_insensitive() {
    assert_eq!(convert::classify(Path::new("X.DOCX")), convert::Kind::Office);
    assert_eq!(convert::classify(Path::new("x.Pdf")), convert::Kind::Pdf);
    assert_eq!(convert::classify(Path::new("x.zip")), convert::Kind::Unsupported);
}

/// Gộp file thật của bạn: đặt FOLIOSCOPE_TEST_FILES="đường/dẫn1|đường/dẫn2|..." (PDF, Word, ảnh...). Bỏ qua nếu không đặt.
#[test]
fn combines_real_files_from_env() {
    let Ok(list) = std::env::var("FOLIOSCOPE_TEST_FILES") else { return };
    let d = tempdir().unwrap();
    let out = d.path().join("ket-qua.pdf");
    let files = list.split('|').map(|p| (PathBuf::from(p), "x")).collect();
    let res = run(&req(files, out.clone(), true, Compression::Balanced)).unwrap();
    assert!(res.pages > 0);
    assert_eq!(Document::load(&out).unwrap().get_pages().len(), res.pages);
    if let Ok(keep) = std::env::var("FOLIOSCOPE_TEST_KEEP") { std::fs::copy(&out, keep).unwrap(); }
}

/// PDF `n` trang, mỗi trang một dấu trang gốc "<tên> mục k" trỏ đúng trang đó (dạng đích tường minh).
fn make_pdf_with_outline(path: &Path, n: usize, name: &str) {
    make_pdf(path, n, (300, 400), name);
    let mut doc = Document::load(path).unwrap();
    let pages: Vec<_> = doc.get_pages().into_values().collect();
    let root = doc.new_object_id();
    let ids: Vec<_> = pages.iter().map(|_| doc.new_object_id()).collect();
    for (i, page) in pages.iter().enumerate() {
        let mut d = dictionary! {
            "Title" => lopdf::text_string(&format!("{name} mục {}", i + 1)),
            "Parent" => root,
            "Dest" => vec![Object::Reference(*page), "Fit".into()],
        };
        if i > 0 { d.set("Prev", ids[i - 1]); }
        if i + 1 < ids.len() { d.set("Next", ids[i + 1]); }
        doc.objects.insert(ids[i], Object::Dictionary(d));
    }
    doc.objects.insert(root, Object::Dictionary(dictionary! {
        "Type" => "Outlines", "First" => ids[0], "Last" => *ids.last().unwrap(), "Count" => ids.len() as i64,
    }));
    let cat = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    doc.get_dictionary_mut(cat).unwrap().set("Outlines", root);
    doc.save(path).unwrap();
}

/// Đọc cây dấu trang của file kết quả thành danh sách (cấp, tiêu đề, số trang đích bắt đầu từ 1).
fn read_outline(doc: &Document) -> Vec<(usize, String, Option<u32>)> {
    fn title(d: &lopdf::Dictionary) -> String {
        match d.get(b"Title") {
            Ok(Object::String(b, _)) => {
                if b.starts_with(&[0xFE, 0xFF]) {
                    let u: Vec<u16> = b[2..].chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                    String::from_utf16_lossy(&u)
                } else {
                    String::from_utf8_lossy(b).into_owned()
                }
            }
            _ => String::new(),
        }
    }
    let page_no: std::collections::HashMap<_, _> = doc.get_pages().into_iter().map(|(n, id)| (id, n)).collect();
    fn walk(doc: &Document, first: Option<lopdf::ObjectId>, level: usize, pn: &std::collections::HashMap<lopdf::ObjectId, u32>, out: &mut Vec<(usize, String, Option<u32>)>) {
        let mut cur = first;
        while let Some(id) = cur {
            let d = doc.get_dictionary(id).unwrap();
            let dest = d.get(b"Dest").ok().and_then(|o| o.as_array().ok()).and_then(|a| a.first()).and_then(|o| o.as_reference().ok()).and_then(|r| pn.get(&r).copied());
            out.push((level, title(d), dest));
            walk(doc, d.get(b"First").ok().and_then(|o| o.as_reference().ok()), level + 1, pn, out);
            cur = d.get(b"Next").ok().and_then(|o| o.as_reference().ok());
        }
    }
    let root = doc.catalog().unwrap().get(b"Outlines").ok().and_then(|o| o.as_reference().ok());
    let first = root.and_then(|r| doc.get_dictionary(r).ok()).and_then(|d| d.get(b"First").ok()).and_then(|o| o.as_reference().ok());
    let mut out = vec![];
    walk(doc, first, 0, &page_no, &mut out);
    out
}

#[test]
fn keeps_original_bookmarks_nested_under_each_file() {
    let d = tempdir().unwrap();
    let (a, b, out) = (d.path().join("a.pdf"), d.path().join("b.pdf"), d.path().join("out.pdf"));
    make_pdf_with_outline(&a, 2, "A");
    make_pdf_with_outline(&b, 1, "B");
    let mut r = req(vec![(a, "Tệp A"), (b, "")], out.clone(), true, Compression::None);
    r.keep_bookmarks = true;
    run(&r).unwrap();
    let got = read_outline(&Document::load(&out).unwrap());
    let want: Vec<(usize, String, Option<u32>)> = vec![
        (0, "Tệp A".into(), Some(1)),
        (1, "A mục 1".into(), Some(1)),
        (1, "A mục 2".into(), Some(2)),
        (0, "B mục 1".into(), Some(3)), // file không có tiêu đề: dấu trang gốc lên cấp cao nhất
    ];
    assert_eq!(got, want);

    // không bật "giữ dấu trang gốc" thì chỉ còn dấu trang theo tên file
    let mut r = req(vec![(d.path().join("a.pdf"), "Tệp A")], d.path().join("o2.pdf"), true, Compression::None);
    r.keep_bookmarks = false;
    run(&r).unwrap();
    assert_eq!(read_outline(&Document::load(d.path().join("o2.pdf")).unwrap()).len(), 1);
}

#[test]
fn password_protected_pdf_needs_the_right_password() {
    use lopdf::encryption::{EncryptionState, EncryptionVersion, Permissions};
    let d = tempdir().unwrap();
    let (plain, locked, out) = (d.path().join("plain.pdf"), d.path().join("locked.pdf"), d.path().join("out.pdf"));
    make_pdf(&plain, 1, (300, 400), "P");
    make_pdf(&locked, 2, (300, 400), "L");
    let mut doc = Document::load(&locked).unwrap();
    doc.trailer.set("ID", Object::Array(vec![Object::string_literal(vec![1u8; 16]), Object::string_literal(vec![2u8; 16])]));
    let state = EncryptionState::try_from(EncryptionVersion::V2 {
        document: &doc, owner_password: "chu", user_password: "mo-ra", key_length: 128, permissions: Permissions::all(),
    }).unwrap();
    doc.encrypt(&state).unwrap();
    doc.save(&locked).unwrap();

    assert!(matches!(merge::load(&locked, None), Err(merge::LoadError::Password { wrong: false })));
    assert!(matches!(merge::load(&locked, Some("sai")), Err(merge::LoadError::Password { wrong: true })));
    assert_eq!(merge::load(&locked, Some("mo-ra")).unwrap().get_pages().len(), 2);

    let mut r = req(vec![(plain.clone(), "P"), (locked.clone(), "L")], out.clone(), false, Compression::None);
    assert!(run(&r).unwrap_err().to_string().starts_with("locked.pdf:"));
    r.files[1].password = Some("mo-ra".into());
    assert_eq!(run(&r).unwrap().pages, 3);
}

#[test]
fn normalizes_every_page_to_a4() {
    let d = tempdir().unwrap();
    let (a, b, out) = (d.path().join("a.pdf"), d.path().join("b.pdf"), d.path().join("out.pdf"));
    make_pdf(&a, 1, (300, 300), "A");
    make_pdf(&b, 1, (800, 400), "B");
    let mut r = req(vec![(a, "A"), (b, "B")], out.clone(), false, Compression::None);
    r.normalize_a4 = true;
    run(&r).unwrap();
    let doc = Document::load(&out).unwrap();
    let sizes: Vec<(f32, f32)> = doc.get_pages().values().map(|id| {
        let mb = doc.get_dictionary(*id).unwrap().get(b"MediaBox").unwrap().as_array().unwrap();
        (mb[2].as_float().unwrap(), mb[3].as_float().unwrap())
    }).collect();
    assert_eq!(sizes, vec![(595.0, 842.0), (842.0, 595.0)]);
    // nội dung vẫn còn và đọc được
    let text = doc.extract_text(&[1, 2]).unwrap();
    assert!(text.contains("A trang 1") && text.contains("B trang 1"), "{text}");
}

#[test]
fn legacy_rc4_pdf_unlocks_with_password() {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let d = tempdir().unwrap();
    let locked = d.path().join("cu.pdf");
    std::fs::write(&locked, STANDARD.decode(crate::pdf::ENCRYPTED_PDF).unwrap()).unwrap();
    assert!(matches!(merge::load(&locked, None), Err(merge::LoadError::Password { wrong: false })));
    assert!(matches!(merge::load(&locked, Some("sai")), Err(merge::LoadError::Password { wrong: true })));
    assert_eq!(merge::load(&locked, Some("matkhau")).unwrap().get_pages().len(), 1);
}

#[test]
fn ocr_images_makes_text_searchable_when_tesseract_is_installed() {
    if crate::ocr_install::find().is_none() { return; }
    use pdfium_render::prelude::*;
    let dir = std::env::temp_dir().join(format!("folioscope-combine-ocr-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("goc.pdf");
    make_pdf(&src, 1, (595, 842), "Hello Folioscope OCR");
    let pdfium = crate::pdf::bind().unwrap();
    let doc = pdfium.load_pdf_from_file(&src, None).unwrap();
    let img = doc.pages().get(0).unwrap().render_with_config(&PdfRenderConfig::new().set_target_width(1700)).unwrap().as_image().unwrap();
    let png = dir.join("scan.png");
    img.save_with_format(&png, image::ImageFormat::Png).unwrap();
    let out = dir.join("out.pdf");
    let mut r = req(vec![(png, "")], out.clone(), false, Compression::None);
    r.ocr_images = true;
    r.ocr_lang = "eng".into();
    let res = run(&r).expect("gộp được");
    assert_eq!(res.converted, 1);
    let text = pdfium.load_pdf_from_file(&out, None).unwrap().pages().iter().map(|p| p.text().unwrap().all()).collect::<String>();
    assert!(text.contains("Folioscope"), "{text}");
    let _ = std::fs::remove_dir_all(&dir);
}
