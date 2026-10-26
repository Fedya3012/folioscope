//! Chuẩn hoá khổ giấy: co (hoặc giãn) mọi trang cho vừa khổ A4, giữ tỉ lệ và đặt giữa trang.

use lopdf::{dictionary, Document, Object, ObjectId, Stream};

/// A4 theo điểm PDF (khớp với phần chuyển ảnh sang PDF).
pub const A4: (f32, f32) = (595.0, 842.0);

/// Phép biến đổi đưa hộp nhìn thấy `(x0, y0, x1, y1)` của trang có góc xoay `rot` vào đúng khổ A4.
/// Trả về `(khổ mới chưa xoay, hệ số co, tx, ty)`.
pub fn plan(visible: (f32, f32, f32, f32), rot: i32) -> ((f32, f32), f32, f32, f32) {
    let (x0, y0, x1, y1) = visible;
    let (w, h) = ((x1 - x0).max(1.0), (y1 - y0).max(1.0));
    let turned = rot.rem_euclid(180) == 90;
    let (dw, dh) = if turned { (h, w) } else { (w, h) };
    // trang ngang thì dùng A4 ngang
    let (aw, ah) = if dw > dh { (A4.1, A4.0) } else { A4 };
    // khổ mới theo toạ độ chưa xoay
    let (tw, th) = if turned { (ah, aw) } else { (aw, ah) };
    let s = (tw / w).min(th / h);
    let tx = (tw - w * s) / 2.0 - x0 * s;
    let ty = (th - h * s) / 2.0 - y0 * s;
    ((tw, th), s, tx, ty)
}

fn number(o: &Object) -> Option<f32> {
    match o {
        Object::Integer(i) => Some(*i as f32),
        Object::Real(r) => Some(*r),
        _ => None,
    }
}

fn rect_of(doc: &Document, page: &lopdf::Dictionary, key: &[u8]) -> Option<(f32, f32, f32, f32)> {
    let obj = page.get(key).ok()?;
    let obj = match obj {
        Object::Reference(r) => doc.get_object(*r).ok()?,
        o => o,
    };
    let a = obj.as_array().ok()?;
    let v: Vec<f32> = a
        .iter()
        .map(|o| match o {
            Object::Reference(r) => doc.get_object(*r).ok().and_then(number),
            o => number(o),
        })
        .collect::<Option<_>>()?;
    (v.len() == 4).then(|| (v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])))
}

/// Chuẩn hoá mọi trang về A4. Trả số trang đã đổi. Vùng liên kết (Rect của ghi chú) được dời theo trang.
pub fn normalize_a4(doc: &mut Document) -> usize {
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let mut changed = 0;
    for id in pages {
        let Ok(page) = doc.get_dictionary(id) else { continue };
        let Some(media) = rect_of(doc, page, b"MediaBox") else { continue };
        let visible = rect_of(doc, page, b"CropBox").unwrap_or(media);
        let rot = page.get(b"Rotate").ok().and_then(number).unwrap_or(0.0) as i32;
        let ((tw, th), s, tx, ty) = plan(visible, rot);
        let already = (s - 1.0).abs() < 1e-3 && tx.abs() < 0.5 && ty.abs() < 0.5 && visible == media;
        if already {
            continue;
        }

        // Nội dung: q <ma trận> cm  …nội dung gốc…  Q
        let mut parts: Vec<Object> = Vec::new();
        match page.get(b"Contents") {
            Ok(Object::Reference(r)) => match doc.get_object(*r) {
                Ok(Object::Array(a)) => parts.extend(a.iter().cloned()),
                _ => parts.push(Object::Reference(*r)),
            },
            Ok(Object::Array(a)) => parts.extend(a.iter().cloned()),
            _ => {}
        }
        let annots: Vec<ObjectId> = match page.get(b"Annots") {
            Ok(Object::Array(a)) => a.iter().filter_map(|o| o.as_reference().ok()).collect(),
            Ok(Object::Reference(r)) => match doc.get_object(*r) {
                Ok(Object::Array(a)) => a.iter().filter_map(|o| o.as_reference().ok()).collect(),
                _ => Vec::new(),
            },
            _ => Vec::new(),
        };
        let head = doc.add_object(Stream::new(
            dictionary! {},
            format!("q {s:.5} 0 0 {s:.5} {tx:.3} {ty:.3} cm\n").into_bytes(),
        ));
        let tail = doc.add_object(Stream::new(dictionary! {}, b"\nQ".to_vec()));
        let mut contents = vec![Object::Reference(head)];
        contents.extend(parts);
        contents.push(Object::Reference(tail));

        for a in annots {
            let Ok(d) = doc.get_dictionary_mut(a) else { continue };
            let Ok(Object::Array(r)) = d.get(b"Rect").cloned() else { continue };
            let v: Vec<f32> = r.iter().filter_map(number).collect();
            if v.len() == 4 {
                let moved = [v[0] * s + tx, v[1] * s + ty, v[2] * s + tx, v[3] * s + ty];
                d.set("Rect", moved.iter().map(|n| Object::Real(*n)).collect::<Vec<_>>());
            }
        }

        let Ok(page) = doc.get_dictionary_mut(id) else { continue };
        page.set("Contents", contents);
        page.set("MediaBox", vec![0.into(), 0.into(), Object::Real(tw), Object::Real(th)]);
        for key in [&b"CropBox"[..], b"TrimBox", b"BleedBox", b"ArtBox"] {
            page.remove(key);
        }
        changed += 1;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_and_centers_into_a4() {
        // trang vuông 300x300 vào A4 dọc: co giãn tới vừa chiều rộng 595, đặt giữa theo chiều cao
        let ((tw, th), s, tx, ty) = plan((0.0, 0.0, 300.0, 300.0), 0);
        assert_eq!((tw, th), (595.0, 842.0));
        assert!((s - 595.0 / 300.0).abs() < 1e-4);
        assert!(tx.abs() < 1e-3);
        assert!((ty - (842.0 - 595.0) / 2.0).abs() < 1e-3);
    }

    #[test]
    fn landscape_pages_get_landscape_a4_and_rotation_is_respected() {
        let ((tw, th), ..) = plan((0.0, 0.0, 800.0, 400.0), 0);
        assert_eq!((tw, th), (842.0, 595.0));
        // trang 400x800 xoay 90° hiển thị ngang → A4 ngang, tức khổ chưa xoay là 595x842
        let ((tw, th), ..) = plan((0.0, 0.0, 400.0, 800.0), 90);
        assert_eq!((tw, th), (595.0, 842.0));
    }

    #[test]
    fn offset_media_box_moves_to_origin() {
        let (_, s, tx, ty) = plan((100.0, 50.0, 100.0 + 595.0, 50.0 + 842.0), 0);
        assert!((s - 1.0).abs() < 1e-4);
        assert!((tx + 100.0).abs() < 1e-3 && (ty + 50.0).abs() < 1e-3);
    }
}
