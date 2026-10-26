use std::path::{Path, PathBuf};

use lopdf::{dictionary, Document, Object, Stream};

use super::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("folioscope-tr-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// PDF thử nghiệm một trang A4 với các dòng chữ đặt ở toạ độ cho trước: (chữ, x, y, cỡ).
fn make_pdf(path: &Path, items: &[(&str, i32, i32, i32)]) {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
    let content: String = items.iter().map(|(t, x, y, sz)| format!("BT /F1 {sz} Tf {x} {y} Td ({t}) Tj ET\n")).collect();
    let content = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id, "Contents" => content,
        "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
    });
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
        "Type" => "Pages", "Kids" => vec![Object::Reference(page)], "Count" => 1,
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
    }));
    let cat = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", cat);
    doc.save(path).unwrap();
}

fn request(files: Vec<PathBuf>, out_dir: PathBuf, target: Target) -> Request {
    Request { files, out_dir, target, pdfa: false, lang: "eng".into(), dpi: 100 }
}

fn go(req: &Request) -> Vec<ItemResult> {
    run(req, &CancelFlag::default(), &mut |_| {}).expect("chạy được")
}

fn text_of(pdf: &Path) -> String {
    let pdfium = crate::pdf::bind().unwrap();
    let doc = pdfium.load_pdf_from_file(pdf, None).unwrap();
    doc.pages().iter().map(|p| p.text().unwrap().all()).collect::<Vec<_>>().join("\n")
}

#[test]
fn unique_path_adds_counter() {
    let dir = scratch("unique");
    assert_eq!(unique_path(&dir, "a", "pdf"), dir.join("a.pdf"));
    std::fs::write(dir.join("a.pdf"), b"").unwrap();
    assert_eq!(unique_path(&dir, "a", "pdf"), dir.join("a (2).pdf"));
    std::fs::write(dir.join("a (2).pdf"), b"").unwrap();
    assert_eq!(unique_path(&dir, "a", "pdf"), dir.join("a (3).pdf"));
}

#[test]
fn html_escapes_and_wraps_pages() {
    let h = html_document("A & B", &["x < y\n\nz".into(), "hai".into()]);
    assert!(h.contains("<title>A &amp; B</title>") && h.contains("<p>x &lt; y</p>") && h.contains("id=\"trang-2\""));
    assert_eq!(h.matches("<p>").count(), 3);
}

#[test]
fn pdf_to_text_and_html_keep_the_words() {
    let dir = scratch("text");
    let pdf = dir.join("tai lieu.pdf");
    make_pdf(&pdf, &[("Xin chao Folioscope", 50, 700, 20), ("Dong thu hai", 50, 660, 20)]);
    for target in [Target::Txt, Target::Html] {
        let r = go(&request(vec![pdf.clone()], dir.clone(), target));
        assert!(r[0].error.is_none(), "{:?}", r[0].error);
        let body = std::fs::read_to_string(&r[0].outputs[0]).unwrap();
        assert!(body.contains("Xin chao Folioscope") && body.contains("Dong thu hai"), "{body}");
    }
}

#[test]
fn pdf_to_xlsx_puts_table_cells_in_columns() {
    let dir = scratch("xlsx");
    let pdf = dir.join("bang.pdf");
    make_pdf(&pdf, &[("Ten", 50, 700, 12), ("Tuoi", 250, 700, 12), ("An", 50, 680, 12), ("30", 250, 680, 12)]);
    let r = go(&request(vec![pdf], dir.clone(), Target::Xlsx));
    assert!(r[0].error.is_none(), "{:?}", r[0].error);
    let mut z = zip::ZipArchive::new(std::fs::File::open(&r[0].outputs[0]).unwrap()).unwrap();
    let mut sheet = String::new();
    std::io::Read::read_to_string(&mut z.by_name("xl/worksheets/sheet1.xml").unwrap(), &mut sheet).unwrap();
    assert!(sheet.contains(r#"r="A1""#) && sheet.contains(">Ten<"), "{sheet}");
    assert!(sheet.contains(r#"r="B1""#) && sheet.contains(">Tuoi<"), "{sheet}");
    assert!(sheet.contains(r#"r="B2""#) && sheet.contains("<v>30</v>"), "{sheet}");
}

#[test]
fn pdf_to_images_writes_one_file_per_page_in_new_folder() {
    let dir = scratch("img");
    let pdf = dir.join("trang.pdf");
    make_pdf(&pdf, &[("Anh", 50, 700, 30)]);
    for (target, magic) in [(Target::Png, &[0x89u8, b'P', b'N', b'G'][..]), (Target::Jpg, &[0xFF, 0xD8][..])] {
        let r = go(&request(vec![pdf.clone()], dir.clone(), target));
        assert!(r[0].error.is_none(), "{:?}", r[0].error);
        assert_eq!(r[0].outputs.len(), 1);
        let bytes = std::fs::read(&r[0].outputs[0]).unwrap();
        assert!(bytes.starts_with(magic));
        assert!(r[0].outputs[0].parent().unwrap().ends_with(if target == Target::Png { "trang" } else { "trang (2)" }));
    }
}

#[test]
fn wrong_input_kind_is_reported_per_file_not_fatal() {
    let dir = scratch("kinds");
    let pdf = dir.join("a.pdf");
    make_pdf(&pdf, &[("A", 50, 700, 12)]);
    let txt = dir.join("b.txt");
    std::fs::write(&txt, "x").unwrap();
    let r = go(&request(vec![txt, pdf], dir.clone(), Target::Txt));
    assert!(r[0].error.as_deref().unwrap().contains("chỉ chuyển được từ file PDF"));
    assert!(r[1].error.is_none());
    // PDF sang PDF không có việc gì để làm trừ khi chọn PDF/A.
    let r = go(&request(vec![dir.join("a.pdf")], dir.clone(), Target::ToPdf));
    assert!(r[0].error.as_deref().unwrap().contains("đã là PDF"));
}

#[test]
fn image_to_pdf_without_office() {
    let dir = scratch("toimg");
    let png = dir.join("anh.png");
    image::RgbImage::from_pixel(40, 30, image::Rgb([200, 30, 30])).save(&png).unwrap();
    let r = go(&request(vec![png], dir.clone(), Target::ToPdf));
    assert!(r[0].error.is_none(), "{:?}", r[0].error);
    assert!(r[0].outputs[0].ends_with("anh.pdf"));
    assert_eq!(Document::load(&r[0].outputs[0]).unwrap().get_pages().len(), 1);
}

#[test]
fn office_missing_is_signalled() {
    if convert::find_office().is_some() { return; }
    let dir = scratch("nooffice");
    let doc = dir.join("a.docx");
    std::fs::write(&doc, b"x").unwrap();
    let err = run(&request(vec![doc], dir, Target::ToPdf), &CancelFlag::default(), &mut |_| {}).unwrap_err();
    assert_eq!(err, "OFFICE_MISSING");
}

#[test]
fn office_conversions_when_libreoffice_is_installed() {
    if convert::find_office().is_none() { return; }
    let dir = scratch("office");
    let pdf = dir.join("goc.pdf");
    make_pdf(&pdf, &[("Chuyen doi Office", 50, 700, 20)]);

    // Word -> PDF/A -> kiểm tra dấu hiệu PDF/A trong metadata.
    let txt = dir.join("ghi chu.txt");
    std::fs::write(&txt, "Noi dung luu tru").unwrap();
    let mut req = request(vec![txt], dir.clone(), Target::ToPdf);
    req.pdfa = true;
    let r = go(&req);
    assert!(r[0].error.is_none(), "{:?}", r[0].error);
    let bytes = std::fs::read(&r[0].outputs[0]).unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("pdfaid"), "thiếu dấu hiệu PDF/A");

    // PDF -> Word, PDF -> PowerPoint.
    for (t, ext) in [(Target::Docx, "docx"), (Target::Pptx, "pptx")] {
        let r = go(&request(vec![pdf.clone()], dir.clone(), t));
        assert!(r[0].error.is_none(), "{ext}: {:?}", r[0].error);
        let mut z = zip::ZipArchive::new(std::fs::File::open(&r[0].outputs[0]).unwrap()).unwrap();
        assert!(z.by_name("[Content_Types].xml").is_ok(), "{ext} không phải gói Office hợp lệ");
    }
}

#[test]
fn ocr_makes_scanned_image_and_pdf_searchable() {
    if crate::ocr_install::find().is_none() { return; }
    use pdfium_render::prelude::*;
    let dir = scratch("ocr");
    let src = dir.join("goc.pdf");
    make_pdf(&src, &[("Hello Folioscope reads this scanned page", 50, 700, 28)]);
    // Dựng trang thành ảnh để giả làm bản quét.
    let pdfium = crate::pdf::bind().unwrap();
    let doc = pdfium.load_pdf_from_file(&src, None).unwrap();
    let img = doc.pages().get(0).unwrap().render_with_config(&PdfRenderConfig::new().set_target_width(1700)).unwrap().as_image().unwrap();
    let png = dir.join("scan.png");
    img.save_with_format(&png, image::ImageFormat::Png).unwrap();
    assert!(!text_of(&src).is_empty());

    let r = go(&request(vec![png], dir.clone(), Target::Ocr));
    assert!(r[0].error.is_none(), "{:?}", r[0].error);
    assert!(text_of(&r[0].outputs[0]).contains("Folioscope"), "ảnh: {}", text_of(&r[0].outputs[0]));

    // PDF quét (chỉ có ảnh) -> PDF tìm kiếm được.
    let scan_pdf = dir.join("scan.pdf");
    let r = go(&request(vec![dir.join("scan.png")], dir.clone(), Target::ToPdf));
    std::fs::rename(&r[0].outputs[0], &scan_pdf).unwrap();
    assert!(!text_of(&scan_pdf).contains("Folioscope"));
    let r = go(&request(vec![scan_pdf], dir.clone(), Target::Ocr));
    assert!(r[0].error.is_none(), "{:?}", r[0].error);
    assert!(text_of(&r[0].outputs[0]).contains("Folioscope"));
}

#[test]
fn parse_language_selection() {
    assert_eq!(ocr::parse_langs("vie+eng"), ["vie", "eng"]);
    assert_eq!(ocr::parse_langs(" vie , eng+vie "), ["vie", "eng"]);
    assert!(ocr::parse_langs("").is_empty());
}
