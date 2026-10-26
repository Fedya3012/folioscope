import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initDb } from "./lib/db";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/organizer.css";
import "./styles/annotations.css";
import "./styles/home.css";
import "./styles/settings.css";
import "./styles/toast.css";
import "./styles/compare.css";
import "./styles/ai.css";

// Nạp cài đặt và danh sách file gần đây từ SQLite trước khi các store khởi tạo (App được nạp sau để store đọc được dữ liệu).
void initDb()
  .then(() => import("./App"))
  .then(({ App }) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
