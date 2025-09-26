// search_server.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

// 正規化関数
function normalize(str) {
  return str ? str.normalize("NFKC") : "";
}

// データ読み込み
const pesticides = JSON.parse(fs.readFileSync("pesticides.json", "utf8"));
const racRaw = JSON.parse(fs.readFileSync("pesticide_data.json", "utf8"));

// frac, irac, hrac をまとめる
let racData = [];
if (racRaw.frac) racData = racData.concat(racRaw.frac);
if (racRaw.irac) racData = racData.concat(racRaw.irac);
if (racRaw.hrac) racData = racData.concat(racRaw.hrac);

// 静的ファイル (HTML, CSS, JS) 提供
app.use(express.static(path.join(__dirname, "public")));

// API: 農薬検索
app.get("/search", (req, res) => {
  const keyword = req.query.q || "";
  const hits = pesticides.filter(p =>
    normalize(p["農薬の名称_x"]).includes(normalize(keyword))
  );

  if (hits.length === 0) {
    return res.json({ message: `"${keyword}" に該当する農薬は見つかりませんでした。` });
  }

  const results = hits.map(p => {
    // 有効成分で racData 検索（完全一致）
    const matches = racData.filter(r => normalize(r.examples) === normalize(p["有効成分"]));

    return {
      農薬名: p["農薬の名称_x"],
      有効成分: p["有効成分"],
      rac: matches.length > 0 ? matches : null,
    };
  });

  res.json(results);
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
});
