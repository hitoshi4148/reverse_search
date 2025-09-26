import pandas as pd

# ファイル読み込み
basic_df = pd.read_excel("登録基本部.xlsx", engine="openpyxl")
app1_df  = pd.read_excel("登録適用部一.xlsx", engine="openpyxl")
app2_df  = pd.read_excel("登録適用部二.xlsx", engine="openpyxl")

# 適用部を結合
app_df = pd.concat([app1_df, app2_df], ignore_index=True)

# 基本部と適用部を「登録番号」で結合
merged_df = pd.merge(app_df, basic_df, on="登録番号", how="left")

# JSONに変換
merged_df.to_json("pesticides.json", orient="records", force_ascii=False)
