import pandas as pd

# frac
df_frac = pd.read_excel("frac_code_table.xlsx")
df_frac.to_json("frac_code_table.json", orient="records", force_ascii=False, indent=2)

# hrac
df_hrac = pd.read_excel("hrac_code_table.xlsx")
df_hrac.to_json("hrac_code_table.json", orient="records", force_ascii=False, indent=2)

# irac
df_irac = pd.read_excel("irac_code_table.xlsx")
df_irac.to_json("irac_code_table.json", orient="records", force_ascii=False, indent=2)
