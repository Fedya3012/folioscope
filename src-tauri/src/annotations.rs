//! Ghi chú thích do giao diện vẽ vào một bản sao của file PDF (không bao giờ ghi đè file gốc).
//! Toạ độ từ giao diện là tỉ lệ 0..1 với gốc ở góc trên trái; PDF dùng điểm, gốc ở góc dưới trái.

use pdfium_render::prelude::*;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Pt {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub page: u16,
    pub kind: String,
    pub color: String,
    pub stroke_width: f32,
    pub rect: Option<Rect>,
    pub points: Option<Vec<Pt>>,
    pub text: Option<String>,
}

/// "#RRGGBB" -> màu PDF. Màu hỏng thì dùng đen thay vì làm hỏng cả lần lưu.
pub fn parse_color(hex: &str, alpha: u8) -> PdfColor {
    let h = hex.trim_start_matches('#');
    let channel = |i: usize| h.get(i..i + 2).and_then(|s| u8::from_str_radix(s, 16).ok()).unwrap_or(0);
    PdfColor::new(channel(0), channel(2), channel(4), alpha)
}

/// Đổi tỉ lệ trang sang hình chữ nhật PDF (lật trục Y).
pub fn pdf_rect(r: Rect, w: f32, h: f32) -> PdfRect {
    PdfRect::new_from_values((1.0 - r.y - r.h) * h, r.x * w, (1.0 - r.y) * h, (r.x + r.w) * w)
}

fn xy(p: Pt, w: f32, h: f32) -> (PdfPoints, PdfPoints) {
    (PdfPoints::new(p.x * w), PdfPoints::new((1.0 - p.y) * h))
}

fn bounds_of(points: &[Pt], w: f32, h: f32, pad: f32) -> PdfRect {
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in points {
        x0 = x0.min(p.x * w);
        x1 = x1.max(p.x * w);
        y0 = y0.min((1.0 - p.y) * h);
        y1 = y1.max((1.0 - p.y) * h);
    }
    PdfRect::new_from_values(y0 - pad, x0 - pad, y1 + pad, x1 + pad)
}

/// Mũi tên: thân và hai cánh, vẽ chung một đường.
fn arrow_points(a: Pt, b: Pt, w: f32, h: f32, size: f32) -> [(f32, f32); 3] {
    let (ax, ay, bx, by) = (a.x * w, (1.0 - a.y) * h, b.x * w, (1.0 - b.y) * h);
    let ang = (by - ay).atan2(bx - ax);
    let wing = |t: f32| (bx - size * (ang + t).cos(), by - size * (ang + t).sin());
    let spread = std::f32::consts::PI / 7.0;
    [wing(-spread), (bx, by), wing(spread)]
}

fn apply_item(doc: &PdfDocument, page: &mut PdfPage, it: &Item) -> Result<(), PdfiumError> {
    let (w, h) = (page.width().value, page.height().value);
    let sw = PdfPoints::new(it.stroke_width.max(0.5));
    let stroke = parse_color(&it.color, 255);
    let text = it.text.clone().unwrap_or_default();
    let pad = it.stroke_width.max(1.0);

    match (it.kind.as_str(), it.rect, it.points.as_deref()) {
        ("highlight", Some(r), _) => {
            let mut a = page.annotations_mut().create_highlight_annotation()?;
            let rect = pdf_rect(r, w, h);
            a.set_bounds(rect)?;
            a.set_stroke_color(parse_color(&it.color, 255))?;
            a.attachment_points_mut().create_attachment_point_at_end(PdfQuadPoints::from_rect(&rect))?;
        }
        ("underline", Some(r), _) => {
            let mut a = page.annotations_mut().create_underline_annotation()?;
            let rect = pdf_rect(r, w, h);
            a.set_bounds(rect)?;
            a.set_stroke_color(stroke)?;
            a.attachment_points_mut().create_attachment_point_at_end(PdfQuadPoints::from_rect(&rect))?;
        }
        ("strikeout", Some(r), _) => {
            let mut a = page.annotations_mut().create_strikeout_annotation()?;
            let rect = pdf_rect(r, w, h);
            a.set_bounds(rect)?;
            a.set_stroke_color(stroke)?;
            a.attachment_points_mut().create_attachment_point_at_end(PdfQuadPoints::from_rect(&rect))?;
        }
        ("note", Some(r), _) => {
            let mut a = page.annotations_mut().create_text_annotation(&text)?;
            // Biểu tượng ghi chú cỡ 20x20 điểm, đặt tại điểm bấm.
            let (x, y) = (r.x * w, (1.0 - r.y) * h);
            a.set_bounds(PdfRect::new_from_values(y - 20.0, x, y, x + 20.0))?;
            a.set_stroke_color(stroke)?;
        }
        ("text", Some(r), _) => {
            let mut a = page.annotations_mut().create_free_text_annotation(&text)?;
            a.set_bounds(pdf_rect(r, w, h))?;
            a.set_stroke_color(stroke)?;
        }
        ("rect", Some(r), _) => {
            let mut a = page.annotations_mut().create_square_annotation()?;
            a.set_bounds(pdf_rect(r, w, h))?;
            a.set_stroke_color(stroke)?;
            a.set_width(sw)?;
        }
        // pdfium-render chưa có hàm tạo chú thích hình tròn, nên elip được vẽ như nét mực khép kín.
        ("ellipse", Some(r), _) => {
            let pts: Vec<Pt> = (0..=48)
                .map(|i| {
                    let t = i as f32 / 48.0 * std::f32::consts::TAU;
                    Pt { x: r.x + r.w / 2.0 * (1.0 + t.cos()), y: r.y + r.h / 2.0 * (1.0 + t.sin()) }
                })
                .collect();
            let as_ink = Item { kind: "ink".into(), rect: None, points: Some(pts), ..it.clone() };
            return apply_item(doc, page, &as_ink);
        }
        (kind @ ("line" | "arrow" | "ink"), _, Some(pts)) if pts.len() >= 2 => {
            let mut a = page.annotations_mut().create_ink_annotation()?;
            let head = 6.0 + it.stroke_width * 2.0;
            let mut all = pts.to_vec();
            a.set_bounds(bounds_of(&all, w, h, pad + if kind == "arrow" { head } else { 0.0 }))?;
            let (x0, y0) = xy(pts[0], w, h);
            let mut path = PdfPagePathObject::new(doc, x0, y0, Some(stroke), Some(sw), None)?;
            for p in &pts[1..] {
                let (x, y) = xy(*p, w, h);
                path.line_to(x, y)?;
            }
            a.objects_mut().add_path_object(path)?;
            if kind == "arrow" {
                let [l, tip, r] = arrow_points(pts[pts.len() - 2], pts[pts.len() - 1], w, h, head);
                let mut hd = PdfPagePathObject::new(doc, PdfPoints::new(l.0), PdfPoints::new(l.1), Some(stroke), Some(sw), None)?;
                hd.line_to(PdfPoints::new(tip.0), PdfPoints::new(tip.1))?;
                hd.line_to(PdfPoints::new(r.0), PdfPoints::new(r.1))?;
                a.objects_mut().add_path_object(hd)?;
            }
            all.clear();
        }
        _ => {} // loại không biết hoặc thiếu dữ liệu: bỏ qua, không làm hỏng cả lần lưu
    }
    Ok(())
}

/// Thêm toàn bộ ghi chú vào tài liệu đã mở. Trả về số ghi chú đã thêm.
pub fn apply(doc: &PdfDocument, items: &[Item]) -> Result<usize, PdfiumError> {
    let mut n = 0;
    for it in items {
        let mut page = doc.pages().get(it.page as i32)?;
        apply_item(doc, &mut page, it)?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_colors() {
        let c = parse_color("#3D63EE", 255);
        assert_eq!((c.red(), c.green(), c.blue(), c.alpha()), (0x3D, 0x63, 0xEE, 255));
        assert_eq!(parse_color("xyz", 255).red(), 0);
    }

    #[test]
    fn flips_y_axis() {
        let r = pdf_rect(Rect { x: 0.0, y: 0.0, w: 0.5, h: 0.25 }, 600.0, 800.0);
        assert_eq!((r.bottom().value, r.left().value, r.top().value, r.right().value), (600.0, 0.0, 800.0, 300.0));
    }
}
