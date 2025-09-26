// search_server.js (置き換え用)
// Node.js (CommonJS) - implements /search, /detail and /racgroup
const http = require("http");
const fs = require("fs");
const url = require("url");
const path = require("path");

const JSON_URL = "https://drive.google.com/uc?export=download&id=1gjHGITcq7RwDgUVNbmFQf6smo5MgOILQ";
let pesticideList = [];

function downloadJSON(callback) {
  console.log("📥 Downloading pesticides.json...");
  https.get(JSON_URL, res => {
    let data = "";
    res.on("data", chunk => { data += chunk; });
    res.on("end", () => {
      try {
        fs.writeFileSync("pesticides.json", data, "utf8");
        pesticideList = JSON.parse(data);
        console.log("✅ pesticides.json loaded. Count:", pesticideList.length);
        callback();
      } catch (err) {
        console.error("❌ Failed to load pesticides.json:", err);
      }
    });
  }).on("error", err => {
    console.error("❌ Download error:", err);
  });
}

// ダウンロードが完了してからサーバー起動
downloadJSON(() => {
  const http = require("http");
  const url = require("url");

  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (pathname === "/search") {
      const keyword = (parsedUrl.query.keyword || "").toLowerCase();
      const matched = pesticideList.filter(entry =>
        String(entry["農薬の名称_x"]).toLowerCase().includes(keyword)
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(matched));
      return;
    }

















// --- データ読み込み ---
let pesticideList, pesticideData;
try {
  pesticideList = JSON.parse(fs.readFileSync("pesticides.json", "utf8"));
} catch (e) {
  console.error("pesticides.json の読み込みに失敗しました:", e.message);
  process.exit(1);
}
try {
  pesticideData = JSON.parse(fs.readFileSync("pesticide_data.json", "utf8"));
} catch (e) {
  console.error("pesticide_data.json の読み込みに失敗しました:", e.message);
  process.exit(1);
}

// 文字列正規化（全角半角・大/小・余白を吸収）
function normalize(str) {
  if (!str && str !== 0) return "";
  return String(str).normalize("NFKC").toLowerCase().trim();
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // --- /search API ---
  // クライアント側は ?keyword=xxx を投げる想定
  if (pathname === "/search") {
    const keyword = normalize(parsedUrl.query.keyword || "");
    const keywords = keyword.split(/\s+/).filter(Boolean);

    const matched = pesticideList.filter(entry =>
      keywords.every(kw => normalize(entry["農薬の名称_x"]).includes(kw))
    );

    // 登録番号でユニーク化して返す（フロントはこれを期待）
    const unique = [];
    const seen = new Set();
    matched.forEach(e => {
      if (!seen.has(e["登録番号"])) {
        seen.add(e["登録番号"]);
        unique.push({
          "登録番号": e["登録番号"],
          "用途_x": e["用途_x"],
          "農薬の名称_x": e["農薬の名称_x"],
          "正式名称": e["正式名称"]
        });
      }
    });

    console.log("検索ワード:", keyword, "ヒット:", unique.length);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(unique));
    return;
  }

  // --- /detail API ---
  // ?regNo=... または ?reg=... に対応
  if (pathname === "/detail") {
    const reg = parsedUrl.query.regNo || parsedUrl.query.reg;
    console.log("✅ /detail API 呼び出し:", parsedUrl.query);
    if (!reg) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "regNo（または reg）が必要です" }));
      return;
    }

    const detailRows = pesticideList.filter(entry => String(entry["登録番号"]) === String(reg));
    if (detailRows.length === 0) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    // 有効成分（最大5）を収集し、pesticide_data から RAC を探す
    const racList = [];
    detailRows.forEach(row => {
      for (let i = 1; i <= 5; i++) {
        const key = (i === 1) ? "有効成分" : `有効成分${i}`;
        const comp = row[key] || "";
        if (!comp) continue;
        const nc = normalize(comp);
        // pesticideData は { frac: [...], irac: [...], hrac: [...] } の想定
        for (const typeKey of ["frac", "irac", "hrac"]) {
          const arr = pesticideData[typeKey] || [];
          arr.forEach(r => {
            const ex = normalize(r.examples || "");
            // 部分一致（両方向）でマッチ
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

    // 適用情報を見やすい形（フロントが期待する形）で返す
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

    const response = { detail, racList };
    console.log("📦 /detail response:", JSON.stringify(response, null, 2));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(response));
    return;
  }

  // --- /racgroup API ---
  // ?type=FRAC&code=M5 の形式で呼ぶ（クライアントの btn onclick で使用）
  if (pathname === "/racgroup") {
    const type = parsedUrl.query.type;
    const code = parsedUrl.query.code;
    console.log("✅ /racgroup API:", parsedUrl.query);

    if (!type || !code) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "type と code が必要です" }));
      return;
    }

    // pesticideData の中で該当する RAC グループを探す
    const arr = pesticideData[type.toLowerCase()] || [];
    const groupEntries = arr.filter(r => String(r.rac_type) === String(type) && String(r.rac_code) === String(code));

    // groupEntries に対応する成分名（examples）を持つ農薬を pesticideList から抽出
    const sameGroup = [];
    groupEntries.forEach(r => {
      const example = normalize(r.examples || "");
      if (!example) return;
      pesticideList.forEach(p => {
        // 有効成分フィールド群を順にチェック（有効成分, 有効成分②, ...）
        for (let i = 1; i <= 5; i++) {
          const k = (i === 1) ? "有効成分" : `有効成分${i}`;
          const val = p[k];
          if (!val) continue;
          const nval = normalize(val);
          if (nval.includes(example) || example.includes(nval)) {
            sameGroup.push({
              登録番号: p["登録番号"],
              "農薬の名称_x": p["農薬の名称_x"],
              "正式名称": p["正式名称"]
            });
            break; // 1農薬につき1回 push で良い
          }
        }
      });
    });

    // 登録番号でユニーク化して返す
    const uniq = {};
    sameGroup.forEach(e => { uniq[e["登録番号"]] = e; });
    const out = Object.values(uniq);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(out));
    return;
  }

  // --- index.html (静的) ---
  if (pathname === "/" || pathname === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500); res.end("Error loading index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  // --- 静的ファイル（js/cssなど） --- 
  // client が相対パスで要求する場合に備える（簡易）
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

server.listen(3000, () => {
  console.log("✅ サーバー起動: http://localhost:3000");
});
