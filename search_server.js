// search_server.js - turf (芝) 用軽量JSON対応版
const http = require("http");
const fs = require("fs");
const url = require("url");
const path = require("path");

const PORT = process.env.PORT || 3000;

let pesticideList = [];
let pesticideData = {};

// --- 文字列正規化 ---
function normalize(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .normalize("NFKC")
    .replace(/[\s　]+/g, "") // 全角/半角スペース削除
    .toLowerCase();
}

// --- データ読込（同期で起動時に一度だけ） ---
function loadLocalData() {
  try {
    const turfPath = path.join(__dirname, "pesticides_turf.json");
    if (!fs.existsSync(turfPath)) throw new Error("pesticides_turf.json が見つかりません。");
    const raw = fs.readFileSync(turfPath, "utf8");
    pesticideList = JSON.parse(raw);
    console.log("✅ pesticides_turf.json loaded. Count:", pesticideList.length);
  } catch (e) {
    console.error("❌ pesticides_turf.json の読み込みに失敗:", e.message);
    process.exit(1);
  }

  try {
    const dataPath = path.join(__dirname, "pesticide_data.json");
    if (!fs.existsSync(dataPath)) throw new Error("pesticide_data.json が見つかりません。");
    const raw2 = fs.readFileSync(dataPath, "utf8");
    pesticideData = JSON.parse(raw2);
    console.log("✅ pesticide_data.json loaded.");
  } catch (e) {
    console.error("❌ pesticide_data.json の読み込みに失敗:", e.message);
    process.exit(1);
  }
}

// --- 有効成分を行から取り出す（柔軟に対応） ---
function getComponentsFromRow(row) {
  const comps = new Set();
  // 優先的に "有効成分" というキー（代表成分）
  if (row["有効成分"]) comps.add(String(row["有効成分"]).trim());
  // それ以外でキーが "有効成分" で始まるものを収集（全角数字や 2, 3 など）
  Object.keys(row).forEach(k => {
    if (k && k.startsWith("有効成分") && typeof row[k] === "string") {
      const v = row[k].trim();
      if (v && !v.includes("総使用回数") && !v.includes("を含む")) {
        comps.add(v);
      }
    }
  });
  // 返すのは配列（空なら[]）
  return Array.from(comps).filter(Boolean);
}

// --- RACを components から検索する ---
function findRacByComponents(components) {
  const racList = [];
  const seen = new Set();
  const typeKeys = Object.keys(pesticideData); // 期待: ["frac","irac","hrac"] など
  components.forEach(comp => {
    const nc = normalize(comp);
    typeKeys.forEach(typeKey => {
      const arr = pesticideData[typeKey] || [];
      arr.forEach(r => {
        const ex = normalize(r.examples || "");
        if (!ex) return;
        // 部分一致（前後どちらでも）
        if (nc.includes(ex) || ex.includes(nc)) {
          const keyId = `${r.rac_type}-${r.rac_code}`;
          if (!seen.has(keyId)) {
            seen.add(keyId);
            racList.push({
              key: keyId,
              rac_type: r.rac_type,
              rac_code: r.rac_code,
              group_name: r.group_name,
              made_of_action: r.made_of_action,
              examples: r.examples,
              remarks: r.remarks
            });
          }
        }
      });
    });
  });
  return racList;
}

// --- 同一グループ農薬一覧取得 ---
function findSameGroupPesticides(type, code) {
  const arr = pesticideData[type.toLowerCase()] || [];
  const groupEntries = arr.filter(r => String(r.rac_type) === String(type) && String(r.rac_code) === String(code));
  const same = [];
  groupEntries.forEach(r => {
    const example = normalize(r.examples || "");
    if (!example) return;
    pesticideList.forEach(p => {
      const comps = getComponentsFromRow(p);
      for (const c of comps) {
        const nc = normalize(c);
        if (nc.includes(example) || example.includes(nc)) {
          same.push({
            登録番号: p["登録番号"],
            農薬の名称_x: p["農薬の名称_x"],
            正式名称: p["正式名称"]
          });
          break;
        }
      }
    });
  });
  // ユニーク化して返す
  const uniq = {};
  same.forEach(e => { uniq[e.登録番号] = e; });
  return Object.values(uniq);
}

// --- HTTP サーバ作成 ---
function createServer() {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // --- /search ?keyword=... ---
    if (pathname === "/search") {
      const rawKeyword = parsed.query.keyword || "";
      const keyword = normalize(rawKeyword);
      if (!keyword) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify([]));
        return;
      }
      const keywords = keyword.split(/\s+/).filter(Boolean);

      const matched = pesticideList.filter(entry => {
        const name = normalize(entry["農薬の名称_x"] || entry["農薬の名称"] || "");
        const maker = normalize(entry["正式名称"] || "");
        const type = normalize(entry["農薬の種類_x"] || entry["農薬の種類"] || "");
        // すべてのキーワードについてどれかのフィールドに含まれていること
        return keywords.every(kw =>
          (name && name.includes(kw)) ||
          (maker && maker.includes(kw)) ||
          (type && type.includes(kw))
        );
      });

      // 登録番号でユニーク化（表示は1行）
      const unique = [];
      const seen = new Set();
      matched.forEach(e => {
        const reg = e["登録番号"];
        if (!seen.has(reg)) {
          seen.add(reg);
          unique.push({
            登録番号: reg,
            用途_x: e["用途_x"] || "－",
            農薬の名称_x: e["農薬の名称_x"] || "－",
            正式名称: e["正式名称"] || "－"
          });
        }
      });

      console.log("検索ワード:", rawKeyword, "ヒット:", unique.length);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(unique));
      return;
    }

    // --- /detail ?regNo=... ---
    if (pathname === "/detail") {
      const reg = parsed.query.regNo || parsed.query.reg;
      if (!reg) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "regNo が必要です" }));
        return;
      }

      const detailRows = pesticideList.filter(e => String(e["登録番号"]) === String(reg));
      if (detailRows.length === 0) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      // 有効成分群を集めて RAC を探す
      const allComponents = new Set();
      detailRows.forEach(r => {
        getComponentsFromRow(r).forEach(c => allComponents.add(c));
      });
      const componentsArr = Array.from(allComponents);

      const racList = findRacByComponents(componentsArr);

      // 適用情報を整形して返す（前と同じ項目名に合わせる）
      const detail = detailRows.map(row => ({
        登録番号: row["登録番号"],
        用途_x: row["用途_x"] || "－",
        農薬の種類_x: row["農薬の種類_x"] || row["農薬の種類"] || "－",
        農薬の名称_x: row["農薬の名称_x"] || row["農薬の名称"] || "－",
        正式名称: row["正式名称"] || "－",
        作物名: row["作物名"] || "－",
        適用場所: row["適用場所"] || "－",
        適用病害虫雑草名: row["適用病害虫雑草名"] || "－",
        有効成分: row["有効成分"] || "－",
        濃度: row["濃度"] || "－",
        希釈倍数使用量: row["希釈倍数使用量"] || "－",
        散布液量: row["散布液量"] || "－",
        使用時期: row["使用時期"] || "－",
        総使用回数: row["有効成分①を含む農薬の総使用回数"] || row["有効成分1を含む農薬の総使用回数"] || row["総使用回数"] || "－",
        使用方法: row["使用方法"] || "－"
      }));

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail, racList }));
      return;
    }

    // --- /racgroup ?type=FRAC&code=M5 ---
    if (pathname === "/racgroup") {
      const type = parsed.query.type;
      const code = parsed.query.code;
      if (!type || !code) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "type と code が必要です" }));
        return;
      }
      const same = findSameGroupPesticides(type, code);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(same));
      return;
    }

    // --- index.html 提供 ---
    if (pathname === "/" || pathname === "/index.html") {
      const filePath = path.join(__dirname, "index.html");
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(500); res.end("Error loading index.html"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      });
      return;
    }

    // --- static files (簡易提供) ---
    const staticPath = path.join(__dirname, pathname);
    if (pathname !== "/" && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext = path.extname(staticPath).toLowerCase();
      const mime = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
      res.end(fs.readFileSync(staticPath));
      return;
    }

    // Not Found
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  server.listen(PORT, () => {
    console.log(`✅ サーバー起動: http://localhost:${PORT}`);
  });

  server.on("error", err => {
    console.error("Server error:", err);
    process.exit(1);
  });
}

// --- メイン ---
loadLocalData();
createServer();
