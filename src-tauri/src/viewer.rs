//! Việc phụ của trình xem: mục lục (bookmark), lớp chữ để chọn/sao chép, và tìm kiếm.
//! Toạ độ trả về đã đổi sang tỉ lệ 0..1 của trang, gốc ở góc trên trái, nên giao diện
//! đặt chồng lên trang ở mọi mức zoom mà không cần biết kích thước điểm PDF.

use pdfium_render::prelude::*;
use serde::Serialize;

use crate::pdf::{bind, load, PdfError};

/// Hình chữ nhật theo tỉ lệ trang: [trái, trên, rộng, cao].
pub type NormRect = [f32; 4];

#[derive(Serialize, Debug)]
pub struct OutlineItem {
    pub title: String,
    /// Trang đích (đếm từ 0); None nếu mục này không trỏ tới trang trong file.
    pub page: Option<u16>,
    pub children: Vec<OutlineItem>,
}

#[derive(Serialize, Debug)]
pub struct TextRun {
    pub text: String,
    pub rect: NormRect,
}

#[derive(Serialize, Debug)]
pub struct SearchHit {
    pub page: u16,
    pub rects: Vec<NormRect>,
}

#[derive(Serialize, Debug)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// True khi dừng sớm vì quá nhiều kết quả.
    pub truncated: bool,
}

const MAX_HITS: usize = 2000;

pub(crate) fn norm(r: &PdfRect, pw: f32, ph: f32) -> NormRect {
    let left = r.left().value / pw;
    let top = (ph - r.top().value) / ph;
    [left, top, (r.right().value - r.left().value) / pw, (r.top().value - r.bottom().value) / ph]
}

fn bookmark_page(b: &PdfBookmark) -> Option<u16> {
    let from_dest = |d: PdfDestination| d.page_index().ok().map(|i| i as u16);
    b.destination().and_then(from_dest).or_else(|| {
        let action = b.action()?;
        let local = action.as_local_destination_action()?;
        from_dest(local.destination().ok()?)
    })
}

fn collect(first: Option<PdfBookmark>, depth: usize) -> Vec<OutlineItem> {
    // Giới hạn độ sâu để file hỏng (bookmark vòng) không làm treo.
    if depth > 16 {
        return Vec::new();
    }
    let Some(first) = first else { return Vec::new() };
    let mut items = vec![first.clone()];
    items.extend(first.iter_siblings().skip(1));
    items
        .iter()
        .map(|b| OutlineItem {
            title: b.title().unwrap_or_default(),
            page: bookmark_page(b),
            children: collect(b.first_child(), depth + 1),
        })
        .collect()
}

#[tauri::command]
pub fn get_outline(path: String) -> Result<Vec<OutlineItem>, PdfError> {
    let pdfium = bind()?;
    let doc = load(pdfium, &path)?;
    Ok(collect(doc.bookmarks().root(), 0))
}

#[tauri::command]
pub fn get_text_runs(path: String, index: u16) -> Result<Vec<TextRun>, PdfError> {
    let pdfium = bind()?;
    let doc = load(pdfium, &path)?;
    let page = doc.pages().get(index as i32).map_err(|_| PdfError::PageOutOfRange(index))?;
    let (pw, ph) = (page.width().value, page.height().value);
    let text = page.text().map_err(|e| PdfError::Render(e.to_string()))?;
    Ok(text
        .segments()
        .iter()
        .map(|s| TextRun { text: s.text(), rect: norm(&s.bounds(), pw, ph) })
        .filter(|r| !r.text.trim().is_empty())
        .collect())
}

fn search_doc(path: &str, query: &str, match_case: bool) -> Result<SearchResult, PdfError> {
    let pdfium = bind()?;
    let doc = load(pdfium, path)?;
    let opts = PdfSearchOptions::new().match_case(match_case);
    let mut hits = Vec::new();
    for (i, page) in doc.pages().iter().enumerate() {
        let (pw, ph) = (page.width().value, page.height().value);
        let Ok(text) = page.text() else { continue };
        let Ok(search) = text.search(query, &opts) else { continue };
        while let Some(segs) = search.find_next() {
            hits.push(SearchHit {
                page: i as u16,
                rects: segs.iter().map(|s| norm(&s.bounds(), pw, ph)).collect(),
            });
            if hits.len() >= MAX_HITS {
                return Ok(SearchResult { hits, truncated: true });
            }
        }
    }
    Ok(SearchResult { hits, truncated: false })
}

/// Tìm trong cả tài liệu. Chạy ở luồng nền để không làm đơ cửa sổ khi file hàng trăm trang.
#[tauri::command]
pub async fn search_text(path: String, query: String, match_case: bool) -> Result<SearchResult, PdfError> {
    if query.trim().is_empty() {
        return Ok(SearchResult { hits: vec![], truncated: false });
    }
    tauri::async_runtime::spawn_blocking(move || search_doc(&path, &query, match_case))
        .await
        .map_err(|e| PdfError::Render(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Option<String> { std::env::var("FOLIOSCOPE_TEST_PDF").ok() }

    #[test]
    fn norm_flips_y_axis() {
        let r = PdfRect::new_from_values(100.0, 10.0, 110.0, 30.0); // bottom,left,top,right
        let n = norm(&r, 200.0, 400.0);
        assert!((n[0] - 0.05).abs() < 1e-6 && (n[1] - 0.725).abs() < 1e-6);
        assert!((n[2] - 0.1).abs() < 1e-6 && (n[3] - 0.025).abs() < 1e-6);
    }

    #[test]
    fn text_runs_and_search_on_sample() {
        let Some(path) = sample() else { return };
        let runs = get_text_runs(path.clone(), 5).expect("lấy được lớp chữ");
        let word = runs.iter().flat_map(|r| r.text.split_whitespace()).find(|w| w.chars().count() > 3);
        let Some(word) = word else { return };
        for r in &runs {
            assert!(r.rect.iter().all(|v| v.is_finite()) && r.rect[2] > 0.0 && r.rect[3] > 0.0);
        }
        let res = search_doc(&path, word, false).expect("tìm được");
        assert!(res.hits.iter().any(|h| h.page == 5), "phải thấy từ ở đúng trang {word}");
        assert!(res.hits.iter().all(|h| !h.rects.is_empty()));
    }

    #[test]
    fn outline_on_sample_does_not_panic() {
        let Some(path) = sample() else { return };
        let items = get_outline(path).expect("đọc được mục lục");
        fn walk(items: &[OutlineItem]) { for i in items { walk(&i.children); } }
        walk(&items);
    }
}
