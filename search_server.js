// search_server.js (修正版)
const { http, https } = require("follow-redirects");
const fs = require("fs");
const url = require("url");
const path = require("path");

const JSON_URL = "https://www.dropbox.com/scl/fi/ips7mw0rrecjas9i2aqo9/pesticides.json?rlkey=ypxxnr7wvsy78owklcej1mvtq&st=20ib9m0u&dl=1";
const PORT = process.env.PORT || 3000;

let pesticideList = [];
let pesticideData = {};

// --- normalize 関数 ---
function normalize(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

// --- download pesticides.json （Promise版） ---
function downloadPesticides() {
  return new Promise((resolve, reject) => {
    console.log("📥 Downloading pesticides.json...");
    https.get(JSON_URL, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        if (!data) {
          return reject(new Error("Empty response when downloading pesticides.json"));
        }
        try {
          // 受け取ったデータをローカルに保存（任意）
          try { fs.writeFileSync(path.join(__dirname, "pesticides.json"), data, "utf8"); } catch(e){ /* ignore */ }

          // JSON をパース。pesticides.json のトップが配列かオブジェクトかに対応
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            pesticideList = parsed;
          } else if (parsed["農薬一覧"]) {
            pesticideList = parsed["農薬一覧"];
          } else if (parsed["pesticides"] && Array.isArray(parsed["pesticides"])) {
            pesticideList = parsed["pesticides"];
          } else {
            // もしトップレベルオブジェクトだったら、その配列を推測して取り出す（元データに合わせて）
            // デフォルトは空配列とする
            pesticideList = Array.isArray(parsed) ? parsed : [];
          }
          console.log("✅ pesticides.json loaded. Count:", pesticideList.length);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", err => {
      reject(err);
    });
  });
}

// --- pesticide_data.json をローカルから読み込む ---
function loadPesticideData() {
  const file = path.join(__dirname, "pesticide_data.json");
  if (!fs.existsSync(file)) {
    throw new Error("pesticide_data.json が見つかりません: " + file);
  }
  const txt = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(txt);
  // 期待される形: { frac: [...], irac: [...], hrac: [...] }
  pesticideData = parsed;
  console.log("✅ pesticide_data.json loaded.");
}

// --- サーバー本体（ルート処理） ---
function createServerAndListen() {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // /search ?keyword=...
    if (pathname === "/search") {
      const keyword = normalize(parsedUrl.query.keyword || "");
      const keywords = keyword.split(/\s+/).filter(Boolean);
      const matched = pesticideList.filter(entry => {
        // 検索対象フィールド（必要に応じて増やせます）
        const name = normalize(entry["農薬の名称_x"] || entry["農薬の名称"] || "");
        const maker = normalize(entry["正式名称"] || "");
        const type = normalize(entry["農薬の種類_x"] || entry["農薬の種類"] || "");
        // 全てのキーワードがどれかのフィールドに含まれること
        return keywords.every(kw => (
          (name && name.includes(kw)) ||
          (maker && maker.includes(kw)) ||
          (type && type.includes(kw))
        ));
      });

      // 登録番号でユニーク化して返す
      const unique = [];
      const seen = new Set();
      matched.forEach(e => {
        const reg = e["登録番号"];
        if (!seen.has(reg)) {
          seen.add(reg);
          unique.push({
            登録番号: reg,
            用途_x: e["用途_x"],
            農薬の名称_x: e["農薬の名称_x"],
            正式名称: e["正式名称"]
          });
        }
      });

      console.log("検索ワード:", parsedUrl.query.keyword || "", "ヒット:", unique.length);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(unique));
      return;
    }

    // /detail ?regNo=... or ?reg=...
    if (pathname === "/detail") {
      const reg = parsedUrl.query.regNo || parsedUrl.query.reg;
      if (!reg) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "regNo（または reg）が必要です" }));
        return;
      }
      const detailRows = pesticideList.filter(e => String(e["登録番号"]) === String(reg));
      if (detailRows.length === 0) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      // RAC検索
      const racList = [];
      detailRows.forEach(row => {
        for (let i = 1; i <= 5; i++) {
          const key = (i === 1) ? "有効成分" : `有効成分${i}`;
          const comp = row[key] || "";
          if (!comp) continue;
          const nc = normalize(comp);
          for (const typeKey of ["frac", "irac", "hrac"]) {
            (pesticideData[typeKey] || []).forEach(r => {
              const ex = normalize(r.examples || "");
              if (ex && (nc.includes(ex) || ex.includes(nc))) {
                const keyId = `${r.rac_type}-${r.rac_code}`;
                if (!racList.find(x => x.key === keyId)) {
                  racList.push({
                    key: keyId,
                    rac_type: r.rac_type,
                    rac_code: r.rac_code,
                    group_name: r.group_name,
                    made_of_action: r.made_of_action,
                    examples: r.examples
                  });
                }
              }
            });
          }
        }
      });

      // 適用情報整形
      const detail = detailRows.map(row => ({
        登録番号: row["登録番号"],
        用途_x: row["用途_x"],
        農薬の名称_x: row["農薬の名称_x"],
        正式名称: row["正式名称"],
        作物名: row["作物名"] || "－",
        適用場所: row["適用場所"] || "－",
        適用病害虫雑草名: row["適用病害虫雑草名"] || "－",
        有効成分: row["有効成分"] || "－",
        濃度: row["濃度"] || "－",
        希釈倍数使用量: row["希釈倍数使用量"] || "－",
        散布液量: row["散布液量"] || "－",
        使用時期: row["使用時期"] || "－",
        総使用回数: row["有効成分①を含む農薬の総使用回数"] || row["総使用回数"] || "－",
        使用方法: row["使用方法"] || "－"
      }));

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail, racList }));
      return;
    }

    // /racgroup ?type=FRAC&code=M5
    if (pathname === "/racgroup") {
      const type = parsedUrl.query.type;
      const code = parsedUrl.query.code;
      if (!type || !code) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "type と code が必要です" }));
        return;
      }

      const arr = pesticideData[type.toLowerCase()] || [];
      const groupEntries = arr.filter(r => String(r.rac_type) === String(type) && String(r.rac_code) === String(code));

      const sameGroup = [];
      groupEntries.forEach(r => {
        const example = normalize(r.examples || "");
        if (!example) return;
        pesticideList.forEach(p => {
          for (let i = 1; i <= 5; i++) {
            const k = (i === 1) ? "有効成分" : `有効成分${i}`;
            const val = p[k];
            if (!val) continue;
            const nval = normalize(val);
            if (nval.includes(example) || example.includes(nval)) {
              sameGroup.push({
                登録番号: p["登録番号"],
                農薬の名称_x: p["農薬の名称_x"],
                正式名称: p["正式名称"]
              });
              break;
            }
          }
        });
      });

      const uniq = {};
      sameGroup.forEach(e => { uniq[e["登録番号"]] = e; });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(Object.values(uniq)));
      return;
    }

    // index.html
    if (pathname === "/" || pathname === "/index.html") {
      const filePath = path.join(__dirname, "index.html");
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(500); res.end("Error loading index.html"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      });
      return;
    }

    // static files (簡易)
    const staticPath = path.join(__dirname, req.url);
    if (req.url !== "/" && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext = path.extname(staticPath).toLowerCase();
      const mime = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
      res.end(fs.readFileSync(staticPath));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  server.listen(PORT, () => {
    console.log(`✅ サーバー起動: http://localhost:${PORT}`);
  });

  // エラー（EADDRINUSEなど）をキャッチして優しくログ出す
  server.on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}

// --- 起動処理 ---
(async () => {
  try {
    await downloadPesticides();
    // pesticide_data.json はプロジェクト直下に置く（小さいので repo に含めてOK）
    loadPesticideData();
    createServerAndListen();
  } catch (err) {
    console.error("❌ 起動処理で失敗:", err);
    process.exit(1);
  }
})();
