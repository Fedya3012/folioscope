//! Dựng bảng tính từ chữ trong PDF: gom ký tự thành dòng, tách ô theo khoảng trống rộng, canh cột theo vị trí ngang,
//! rồi ghi file `.xlsx` (mỗi trang một sheet). Không đọc được đường kẻ ô, nên đây là xấp xỉ theo vị trí chữ.

use std::io::Write;

/// Một ký tự trên trang, toạ độ PDF (gốc ở góc dưới trái).
#[derive(Debug, Clone, Copy)]
pub struct Glyph {
    pub c: char,
    pub left: f32,
    pub right: f32,
    pub bottom: f32,
    pub top: f32,
}

/// Các dòng của một trang, từ trên xuống; mỗi dòng gồm các ô (vị trí trái, chữ) từ trái sang phải.
pub fn lines_of_cells(glyphs: &[Glyph]) -> Vec<Vec<(f32, String)>> {
    let mut gs: Vec<Glyph> = glyphs.iter().copied().filter(|g| !g.c.is_whitespace() && !g.c.is_control()).collect();
    if gs.is_empty() { return Vec::new(); }
    gs.sort_by(|a, b| ((b.top + b.bottom) / 2.0).total_cmp(&((a.top + a.bottom) / 2.0)));

    // Gom thành dòng: ký tự cùng dòng khi tâm dọc lệch ít hơn nửa chiều cao.
    let mut rows: Vec<Vec<Glyph>> = Vec::new();
    let mut row_mid = f32::NAN;
    for g in gs {
        let mid = (g.top + g.bottom) / 2.0;
        let h = (g.top - g.bottom).max(1.0);
        match rows.last_mut() {
            Some(row) if (row_mid - mid).abs() <= h * 0.5 => row.push(g),
            _ => {
                rows.push(vec![g]);
                row_mid = mid;
            }
        }
    }

    rows.into_iter()
        .map(|mut row| {
            row.sort_by(|a, b| a.left.total_cmp(&b.left));
            let h = row.iter().map(|g| g.top - g.bottom).fold(0.0f32, f32::max).max(1.0);
            let mut cells: Vec<(f32, String)> = Vec::new();
            let mut prev_right = f32::NAN;
            for g in row {
                let gap = g.left - prev_right;
                match cells.last_mut() {
                    Some(cell) if gap <= h * 0.8 => {
                        if gap > h * 0.15 { cell.1.push(' '); }
                        cell.1.push(g.c);
                    }
                    _ => cells.push((g.left, g.c.to_string())),
                }
                prev_right = g.right;
            }
            cells
        })
        .collect()
}

/// Gán mỗi ô vào một cột: các vị trí trái cách nhau không quá `tol` thuộc cùng một cột.
pub fn to_grid(lines: &[Vec<(f32, String)>], tol: f32) -> Vec<Vec<String>> {
    let mut xs: Vec<f32> = lines.iter().flatten().map(|c| c.0).collect();
    xs.sort_by(f32::total_cmp);
    let mut anchors: Vec<f32> = Vec::new();
    for x in xs {
        if anchors.last().is_none_or(|a| x - a > tol) { anchors.push(x); }
    }
    let col_of = |x: f32| anchors.iter().rposition(|a| *a <= x + tol).unwrap_or(0);
    lines
        .iter()
        .map(|line| {
            let mut row = vec![String::new(); anchors.len()];
            for (x, text) in line {
                let c = col_of(*x);
                if !row[c].is_empty() { row[c].push(' '); }
                row[c].push_str(text);
            }
            // Bỏ ô trống ở cuối dòng.
            while row.last().is_some_and(String::is_empty) { row.pop(); }
            row
        })
        .collect()
}

fn esc(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

pub fn col_name(mut i: usize) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (i % 26) as u8) as char);
        if i < 26 { break; }
        i = i / 26 - 1;
    }
    s
}

/// Chỉ số thật sự (không phải mã có số 0 đứng đầu) mới ghi dạng số.
fn as_number(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() || t.len() > 15 { return None; }
    if t.len() > 1 && t.starts_with('0') && !t.starts_with("0.") { return None; }
    t.parse::<f64>().ok().filter(|v| v.is_finite())
}

fn sheet_xml(grid: &[Vec<String>]) -> String {
    let mut x = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#);
    for (r, row) in grid.iter().enumerate() {
        x.push_str(&format!(r#"<row r="{}">"#, r + 1));
        for (c, text) in row.iter().enumerate().filter(|(_, t)| !t.is_empty()) {
            let at = format!("{}{}", col_name(c), r + 1);
            match as_number(text) {
                Some(v) => x.push_str(&format!(r#"<c r="{at}"><v>{v}</v></c>"#)),
                None => x.push_str(&format!(r#"<c r="{at}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#, esc(text))),
            }
        }
        x.push_str("</row>");
    }
    x.push_str("</sheetData></worksheet>");
    x
}

/// Ghi workbook: mỗi phần tử của `sheets` là lưới ô của một trang.
pub fn write_xlsx(path: &std::path::Path, sheets: &[Vec<Vec<String>>]) -> Result<(), String> {
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(std::io::BufWriter::new(file));
    let opt = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let empty: Vec<Vec<String>> = vec![Vec::new()];
    let sheets: Vec<&Vec<Vec<String>>> = if sheets.is_empty() { vec![&empty] } else { sheets.iter().collect() };
    let n = sheets.len();
    let mut put = |name: &str, body: &str| -> Result<(), String> {
        zip.start_file(name, opt).map_err(|e| e.to_string())?;
        zip.write_all(body.as_bytes()).map_err(|e| e.to_string())
    };

    let overrides: String = (1..=n)
        .map(|i| format!(r#"<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#))
        .collect();
    put("[Content_Types].xml", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>{overrides}</Types>"#))?;
    put("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#)?;
    let names: String = (1..=n).map(|i| format!(r#"<sheet name="Trang {i}" sheetId="{i}" r:id="rId{i}"/>"#)).collect();
    put("xl/workbook.xml", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{names}</sheets></workbook>"#))?;
    let rels: String = (1..=n)
        .map(|i| format!(r#"<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>"#))
        .collect();
    put("xl/_rels/workbook.xml.rels", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#))?;
    for (i, grid) in sheets.iter().enumerate() {
        put(&format!("xl/worksheets/sheet{}.xml", i + 1), &sheet_xml(grid))?;
    }
    zip.finish().map_err(|e| e.to_string())?.flush().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, x: f32, y: f32) -> Vec<Glyph> {
        text.chars()
            .enumerate()
            .map(|(i, c)| Glyph { c, left: x + i as f32 * 5.0, right: x + i as f32 * 5.0 + 5.0, bottom: y, top: y + 10.0 })
            .collect()
    }

    #[test]
    fn groups_glyphs_into_rows_and_columns() {
        let mut g = Vec::new();
        g.extend(word("Tên", 50.0, 700.0));
        g.extend(word("Tuổi", 200.0, 700.0));
        g.extend(word("An", 50.0, 680.0));
        g.extend(word("30", 201.0, 680.0));
        g.extend(word("Bình An", 50.0, 660.0)); // khoảng trắng nhỏ giữa hai từ vẫn là một ô
        let lines = lines_of_cells(&g);
        assert_eq!(lines.len(), 3);
        let grid = to_grid(&lines, 6.0);
        assert_eq!(grid[0], ["Tên", "Tuổi"]);
        assert_eq!(grid[1], ["An", "30"]);
        assert_eq!(grid[2], ["Bình An"]);
    }

    #[test]
    fn column_names_follow_excel() {
        assert_eq!([col_name(0), col_name(25), col_name(26), col_name(27), col_name(701), col_name(702)], ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    }

    #[test]
    fn numbers_keep_codes_as_text() {
        assert_eq!(as_number("12.5"), Some(12.5));
        assert_eq!(as_number("007"), None);
        assert_eq!(as_number("12a"), None);
    }

    #[test]
    fn writes_a_valid_zip_with_sheets() {
        let path = std::env::temp_dir().join(format!("folioscope-xlsx-{}.xlsx", std::process::id()));
        write_xlsx(&path, &[vec![vec!["a & b".into(), "5".into()]], vec![vec!["x".into()]]]).unwrap();
        let mut z = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
        let mut s = String::new();
        std::io::Read::read_to_string(&mut z.by_name("xl/worksheets/sheet1.xml").unwrap(), &mut s).unwrap();
        assert!(s.contains("a &amp; b") && s.contains("<v>5</v>"));
        assert!(z.by_name("xl/worksheets/sheet2.xml").is_ok());
        let _ = std::fs::remove_file(&path);
    }
}
