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
        files: files.into_iter().map(|(path, t)| InputFile { path, title: t.into() }).collect(),
        output: out,
        bookmarks,
        compression,
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
