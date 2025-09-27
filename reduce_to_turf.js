// reduce_to_turf.js
const fs = require("fs");
const data = JSON.parse(fs.readFileSync("pesticides.json", "utf8"));

// 作物名に「芝」が含まれるデータだけ残す
const turfOnly = data.filter(e => {
  const 作物 = e["作物名"] || "";
  return 作物.includes("芝");
});

fs.writeFileSync("pesticides_turf.json", JSON.stringify(turfOnly), "utf8");
console.log("✅ pesticides_turf.json created. Count:", turfOnly.length);
