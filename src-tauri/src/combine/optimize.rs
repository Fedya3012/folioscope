//! Nén file kết quả. Ba mức khớp với hộp thoại: Không / Cân bằng / Tối đa.

use image::{codecs::jpeg::JpegEncoder, ColorType, ImageReader};
use lopdf::{Document, Object};

use super::Compression;

/// Cạnh dài tối đa của ảnh JPEG ở mức Tối đa (khoảng 150 dpi cho khổ A4).
const MAX_EDGE: u32 = 1754;
const JPEG_QUALITY: u8 = 72;

pub fn apply(doc: &mut Document, level: Compression) {
    match level {
        Compression::None => {}
        Compression::Balanced => balanced(doc),
        Compression::Max => {
            downsample_jpegs(doc);
            balanced(doc);
        }
    }
}

fn balanced(doc: &mut Document) {
    doc.delete_zero_length_streams();
    doc.prune_objects();
    doc.compress();
    // Object stream và xref stream được bật khi ghi (save_modern).
}

/// Giảm kích thước ảnh JPEG quá lớn. Chỉ thay khi ảnh mới thật sự nhỏ hơn.
fn downsample_jpegs(doc: &mut Document) {
    for obj in doc.objects.values_mut() {
        let Object::Stream(s) = obj else { continue };
        let is_image = s.dict.get(b"Subtype").and_then(Object::as_name).map(|n| n == b"Image").unwrap_or(false);
        let is_jpeg = s.dict.get(b"Filter").and_then(Object::as_name).map(|n| n == b"DCTDecode").unwrap_or(false);
        if !is_image || !is_jpeg { continue; }
        // Ảnh có mặt nạ cắt (Mask/Decode) giữ nguyên để không lệch.
        if s.dict.has(b"Mask") || s.dict.has(b"Decode") { continue; }
        let Ok(reader) = ImageReader::new(std::io::Cursor::new(&s.content)).with_guessed_format() else { continue };
        let Ok(img) = reader.decode() else { continue };
        // CMYK/ảnh khác 8 bit mỗi kênh: bỏ qua.
        let space = match img.color() {
            ColorType::Rgb8 => "DeviceRGB",
            ColorType::L8 => "DeviceGray",
            _ => continue,
        };
        let declared = s.dict.get(b"ColorSpace").and_then(Object::as_name).map(|n| n.to_vec()).unwrap_or_default();
        if declared != space.as_bytes() { continue; }
        if img.width().max(img.height()) <= MAX_EDGE { continue; }
        let small = img.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Lanczos3);
        let mut buf = Vec::new();
        let enc = JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
        let ok = match small.color() {
            ColorType::Rgb8 => small.to_rgb8().write_with_encoder(enc).is_ok(),
            _ => small.to_luma8().write_with_encoder(enc).is_ok(),
        };
        if !ok || buf.len() >= s.content.len() { continue; }
        s.dict.set("Width", small.width() as i64);
        s.dict.set("Height", small.height() as i64);
        s.set_content(buf);
        s.allows_compression = false; // JPEG đã nén, nén thêm chỉ tốn công.
    }
}
