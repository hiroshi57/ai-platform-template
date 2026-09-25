"""指標カタログ(図鑑の「章」と「ページ」の定義)。

各指標は中学生・高校生が読んでわかる解説(explain)と、SDGs のどの目標に
関係するか(sdg)を持つ。数値の取得元は source + code で表す。

- source="wb"    : World Bank Open Data API(国連機関のデータを多数再集計)
- source="unhcr" : UNHCR(国連難民高等弁務官事務所) Refugee Data Finder API
- source="undp"  : UNDP 人間開発報告書 全時系列 CSV(code は列名の接頭辞 例 "hdi")
- source="owid"  : Our World in Data(オックスフォード大)grapher CSV。
                   code は "<slug>:<列名>"。列名が "*" のときは数値列の合計。
                   Maddison Project(フローニンゲン大)・V-Dem(ヨーテボリ大)・
                   UCDP(ウプサラ大)等の大学データを再配布している。
- source="harvard": ハーバード大 Growth Lab「Growth Projections and Complexity Rankings」(Harvard Dataverse)
- source="epi"    : イェール大 環境パフォーマンス指数(EPI)結果 xlsx(code は列名 例 "EPI.new")
- source="ndgain" : ノートルダム大 ND-GAIN Country Index(code は指標名 例 "gain")
- source="unsdg"  : 国連統計部 SDG Global Database API(code は "系列コード|区分=値/値;区分=値")
- source="uis"    : UNESCO 統計研究所(UIS)Data API(code は指標コード 例 "CR.2")

better:
- "high" … 大きいほど望ましい(例: 平均寿命)
- "low"  … 小さいほど望ましい(例: 乳幼児死亡率)
- None   … 良し悪しでは測らない(例: 面積・人口)
"""

from __future__ import annotations

CATEGORIES = [
    {"id": "geo", "name": "地理・地形", "icon": "🗺️", "color": "#2f9e44",
     "lead": "国の広さ・土地の使われ方・雨の量など、その国の『舞台』を知る章。"},
    {"id": "people", "name": "人口", "icon": "👥", "color": "#1c7ed6",
     "lead": "どれくらいの人が、どんな年齢で、どこに住んでいるかを知る章。"},
    {"id": "climate", "name": "気候・環境", "icon": "🌡️", "color": "#e8590c",
     "lead": "地球温暖化・空気・エネルギーなど、地球全体の課題を知る章。"},
    {"id": "nature", "name": "生き物・自然", "icon": "🦋", "color": "#0ca678",
     "lead": "絶滅が心配される生き物と、自然を守る取り組みを知る章(生物学)。"},
    {"id": "economy", "name": "経済・くらし", "icon": "💰", "color": "#f59f00",
     "lead": "お金・仕事・電気やインターネットなど、日々のくらしを知る章。"},
    {"id": "health", "name": "健康・医療", "icon": "🏥", "color": "#d6336c",
     "lead": "寿命・子どもの命・水やトイレ・栄養など、命と健康を知る章。"},
    {"id": "education", "name": "教育・科学", "icon": "🎓", "color": "#7048e8",
     "lead": "学校に通えるか、科学研究がどれだけ盛んかを知る章。"},
    {"id": "peace", "name": "平和・紛争", "icon": "🕊️", "color": "#495057",
     "lead": "戦争・紛争、治安、難民など、平和をめぐる現実を知る章。"},
    {"id": "human", "name": "人間開発(UNDP)", "icon": "🌱", "color": "#1098ad",
     "lead": "国連開発計画(UNDP)が、健康・教育・所得を組み合わせて『人間らしい豊かさ』を測った章。"},
    {"id": "history", "name": "歴史のデータ", "icon": "📜", "color": "#862e9c",
     "lead": "数百年〜1万年の変化を大学の研究データでたどる章。年スライダーで過去へタイムトラベル。"},
]

# 国連 SDGs 17目標(日本語は国連広報センターの公式訳、色は公式カラー)
SDG_GOALS = [
    {"n": 1, "name": "貧困をなくそう", "color": "#E5243B"},
    {"n": 2, "name": "飢餓をゼロに", "color": "#DDA63A"},
    {"n": 3, "name": "すべての人に健康と福祉を", "color": "#4C9F38"},
    {"n": 4, "name": "質の高い教育をみんなに", "color": "#C5192D"},
    {"n": 5, "name": "ジェンダー平等を実現しよう", "color": "#FF3A21"},
    {"n": 6, "name": "安全な水とトイレを世界中に", "color": "#26BDE2"},
    {"n": 7, "name": "エネルギーをみんなに そしてクリーンに", "color": "#FCC30B"},
    {"n": 8, "name": "働きがいも経済成長も", "color": "#A21942"},
    {"n": 9, "name": "産業と技術革新の基盤をつくろう", "color": "#FD6925"},
    {"n": 10, "name": "人や国の不平等をなくそう", "color": "#DD1367"},
    {"n": 11, "name": "住み続けられるまちづくりを", "color": "#FD9D24"},
    {"n": 12, "name": "つくる責任 つかう責任", "color": "#BF8B2E"},
    {"n": 13, "name": "気候変動に具体的な対策を", "color": "#3F7E44"},
    {"n": 14, "name": "海の豊かさを守ろう", "color": "#0A97D9"},
    {"n": 15, "name": "陸の豊かさも守ろう", "color": "#56C02B"},
    {"n": 16, "name": "平和と公正をすべての人に", "color": "#00689D"},
    {"n": 17, "name": "パートナーシップで目標を達成しよう", "color": "#19486A"},
]


def _i(id_, source, code, cat, name, unit, explain, better=None, sdg=(), decimals=1, scale="linear",
       forecast=True, org=""):
    return {
        "id": id_, "source": source, "code": code, "category": cat, "name": name,
        "unit": unit, "explain": explain, "better": better, "sdg": list(sdg),
        "decimals": decimals, "scale": scale, "forecast": forecast, "org": org,
    }


INDICATORS = [
    # --- 地理・地形 ---
    _i("land_area", "wb", "AG.LND.TOTL.K2", "geo", "国土の面積", "km²",
       "陸地の広さ。日本は約36万km²で、世界ではおよそ60番目前後の広さ。", decimals=0, scale="log"),
    _i("forest", "wb", "AG.LND.FRST.ZS", "geo", "森林の割合", "%",
       "陸地のうち森におおわれている割合。森は二酸化炭素を吸収し、多くの生き物のすみかになる。",
       better="high", sdg=(15,)),
    _i("agri_land", "wb", "AG.LND.AGRI.ZS", "geo", "農地の割合", "%",
       "陸地のうち田畑や牧草地として使われている割合。食料生産と自然保護のバランスを考える手がかり。"),
    _i("density", "wb", "EN.POP.DNST", "geo", "人口密度", "人/km²",
       "1km²あたりに何人住んでいるか。島国や都市国家は高くなりやすい。", decimals=0, scale="log"),
    _i("precip", "wb", "AG.LND.PRCP.MM", "geo", "年間降水量", "mm/年",
       "1年間に降る雨や雪の量の平均。砂漠の国は少なく、熱帯雨林の国は多い。", decimals=0),

    _i("disaster_deaths", "owid",
       "deaths-from-natural-disasters:death_count__age_group_allages__sex_both_sexes__cause_natural_disasters",
       "geo", "自然災害による死者", "人/年",
       "地震・洪水・干ばつ・暴風などの自然災害で亡くなった人の推計(WHO 調べ)。"
       "年によって大きく変わるので推移も見てみよう。",
       better="low", sdg=(11, 13), decimals=0, scale="log", forecast=False, org="WHO / Our World in Data"),

    # --- 人口 ---
    _i("population", "wb", "SP.POP.TOTL", "people", "人口", "人",
       "その国に住んでいる人の数。", decimals=0, scale="log"),
    _i("pop_growth", "wb", "SP.POP.GROW", "people", "人口増加率", "%/年",
       "1年間で人口が何%増えたか(マイナスは減少)。日本は減少が続いている。", decimals=2),
    _i("urban", "wb", "SP.URB.TOTL.IN.ZS", "people", "都市に住む人の割合", "%",
       "人口のうち都市部に住む人の割合。世界では半分以上が都市に住んでいる。", sdg=(11,)),
    _i("fertility", "wb", "SP.DYN.TFRT.IN", "people", "合計特殊出生率", "人",
       "1人の女性が一生のうちに産む子どもの数の平均。約2.1を下回ると、長い目で見て人口が減っていく。",
       decimals=2),
    _i("age65", "wb", "SP.POP.65UP.TO.ZS", "people", "65歳以上の割合(高齢化率)", "%",
       "人口のうち65歳以上の人の割合。日本は世界でもトップクラスに高い。"),
    _i("age0_14", "wb", "SP.POP.0014.TO.ZS", "people", "子ども(0〜14歳)の割合", "%",
       "人口のうち0〜14歳の子どもの割合。アフリカの国々では4割をこえる国もある。"),

    # --- 気候・環境 ---
    _i("co2_pc", "wb", "EN.GHG.CO2.PC.CE.AR5", "climate", "1人あたりCO₂排出量", "t/人",
       "1人あたり1年間にどれだけ二酸化炭素を出しているか。地球温暖化の主な原因。",
       better="low", sdg=(13,), decimals=2),
    _i("renewable", "wb", "EG.FEC.RNEW.ZS", "climate", "再生可能エネルギーの割合", "%",
       "使うエネルギーのうち、太陽光・風力・水力・バイオマスなど、なくならないエネルギーの割合。",
       better="high", sdg=(7, 13)),
    _i("energy_use", "wb", "EG.USE.PCAP.KG.OE", "climate", "1人あたりエネルギー消費量", "kg(石油換算)",
       "1人あたりどれだけのエネルギーを使っているか。くらしの豊かさと環境への負担の両方を表す。",
       better="low", sdg=(12,), decimals=0, scale="log"),
    _i("pm25", "wb", "EN.ATM.PM25.MC.M3", "climate", "PM2.5(大気汚染)", "µg/m³",
       "空気中の小さなちり(PM2.5)の濃さ。高いと呼吸器や心臓の病気が増える。WHOの目安は年平均5以下。",
       better="low", sdg=(11,)),
    _i("water_stress", "wb", "ER.H2O.FWST.ZS", "climate", "水ストレス", "%",
       "使える淡水のうち、どれだけを実際に取り出して使っているか。高いほど水不足が深刻。",
       better="low", sdg=(6,), scale="log"),

    _i("temp_anomaly", "owid", "annual-temperature-anomalies:temperature_anomaly", "climate",
       "気温の平年差", "℃",
       "その年の平均気温が、1991〜2020年の平均より何℃高いか(マイナスは低い)。地球温暖化の進み方がわかる。",
       better="low", sdg=(13,), decimals=2, org="Copernicus(EU)/ Our World in Data"),
    _i("epi", "epi", "EPI.new", "climate", "環境パフォーマンス指数(EPI)", "点",
       "空気や水のきれいさ、生き物のすみか、気候変動対策など約50の指標から、"
       "国の環境への取り組みを0〜100点で評価したもの。",
       better="high", sdg=(6, 11, 13, 14, 15), forecast=False, org="イェール大学・コロンビア大学 EPI"),
    _i("nd_gain", "ndgain", "gain", "climate", "気候変動への備え(ND-GAIN)", "点",
       "気候変動の影響の受けやすさと、それに備える力を合わせた指数(0〜100)。高いほど気候変動に強い。",
       better="high", sdg=(13,), org="ノートルダム大学 ND-GAIN"),
    _i("nd_vuln", "ndgain", "vulnerability", "climate", "気候変動への弱さ(ND-GAIN)", "",
       "食料・水・健康・住まい・インフラ・生態系が、"
       "気候変動でどれだけ被害を受けやすいか(0〜1)。低いほど強い。",
       better="low", sdg=(13,), decimals=3, org="ノートルダム大学 ND-GAIN"),

    # --- 生き物・自然(生物学) ---
    _i("thr_mammal", "wb", "EN.MAM.THRD.NO", "nature", "絶滅が心配される哺乳類", "種",
       "国際自然保護連合(IUCN)のレッドリストで絶滅危惧とされた哺乳類の種の数。",
       better="low", sdg=(15,), decimals=0),
    _i("thr_bird", "wb", "EN.BIR.THRD.NO", "nature", "絶滅が心配される鳥類", "種",
       "IUCNレッドリストで絶滅危惧とされた鳥の種の数。", better="low", sdg=(15,), decimals=0),
    _i("thr_fish", "wb", "EN.FSH.THRD.NO", "nature", "絶滅が心配される魚類", "種",
       "IUCNレッドリストで絶滅危惧とされた魚の種の数。海や川の豊かさの指標。",
       better="low", sdg=(14,), decimals=0),
    _i("thr_plant", "wb", "EN.HPT.THRD.NO", "nature", "絶滅が心配される植物", "種",
       "IUCNレッドリストで絶滅危惧とされた植物(高等植物)の種の数。", better="low", sdg=(15,), decimals=0),
    _i("protected_land", "wb", "ER.LND.PTLD.ZS", "nature", "陸の保護区の割合", "%",
       "国立公園などで守られている陸地の割合。国際目標は2030年までに30%(30by30)。",
       better="high", sdg=(15,)),
    _i("protected_sea", "wb", "ER.MRN.PTMR.ZS", "nature", "海の保護区の割合", "%",
       "自国の海のうち保護区になっている割合。国際目標は2030年までに30%。", better="high", sdg=(14,)),

    _i("epi_bdh", "epi", "BDH.new", "nature", "生物多様性と生息地(EPI)", "点",
       "保護区の広さや質、生き物のすみかの守られ方などから、"
       "生物多様性を守る取り組みを0〜100点で評価したもの。",
       better="high", sdg=(14, 15), forecast=False, org="イェール大学・コロンビア大学 EPI"),
    _i("epi_eco", "epi", "ECO.new", "nature", "生態系の活力(EPI)", "点",
       "森林・漁業・農業・水資源などの生態系が健全に保たれているかを0〜100点で評価したもの。",
       better="high", sdg=(2, 14, 15), forecast=False, org="イェール大学・コロンビア大学 EPI"),

    # --- 経済・くらし ---
    _i("gdp_pc", "wb", "NY.GDP.PCAP.CD", "economy", "1人あたりGDP", "US$",
       "国全体が1年間に生み出した価値(GDP)を人口で割ったもの。国の豊かさの目安。",
       better="high", sdg=(8,), decimals=0, scale="log"),
    _i("gdp", "wb", "NY.GDP.MKTP.CD", "economy", "GDP(国内総生産)", "US$",
       "国全体が1年間に生み出したモノやサービスの価値の合計。経済の大きさ。", decimals=0, scale="log"),
    _i("gdp_growth", "wb", "NY.GDP.MKTP.KD.ZG", "economy", "経済成長率", "%/年",
       "GDPが前の年より何%増えたか(物価の影響を除いた実質)。", better="high", sdg=(8,)),
    _i("poverty", "wb", "SI.POV.DDAY", "economy", "極度の貧困の割合", "%",
       "1日3ドル(2021年の購買力平価)未満でくらす人の割合。SDGsの目標1は、これをなくすこと。",
       better="low", sdg=(1,)),
    _i("unemployment", "wb", "SL.UEM.TOTL.ZS", "economy", "失業率", "%",
       "働きたいのに仕事がない人の割合。", better="low", sdg=(8,)),
    _i("gini", "wb", "SI.POV.GINI", "economy", "ジニ係数(所得の不平等)", "",
       "所得の格差の大きさ(0〜100)。0なら全員が同じ所得、100に近いほど格差が大きい。",
       better="low", sdg=(10,)),
    _i("internet", "wb", "IT.NET.USER.ZS", "economy", "インターネット利用率", "%",
       "インターネットを使っている人の割合。情報や教育へのアクセスの目安。",
       better="high", sdg=(9, 17)),
    _i("electricity", "wb", "EG.ELC.ACCS.ZS", "economy", "電気を使える人の割合", "%",
       "家で電気を使える人の割合。電気がないと夜の勉強や医療が難しくなる。", better="high", sdg=(7,)),

    _i("eci", "harvard", "eci_hs92", "economy", "経済の複雑さ(ECI)", "",
       "その国がどれだけ多くの種類の、つくるのが難しい製品を輸出しているか。"
       "知識や技術の蓄積の目安(0が世界平均)。",
       better="high", sdg=(8, 9), decimals=2, org="ハーバード大学 Growth Lab"),
    _i("growth_proj", "harvard", "growth_proj", "economy", "今後10年の成長見通し", "%/年",
       "経済の複雑さと今の豊かさから、ハーバード大学が予測した今後10年間の年平均の経済成長率。",
       sdg=(8,), decimals=2, forecast=False, org="ハーバード大学 Growth Lab"),

    # --- 健康・医療 ---
    _i("life_exp", "wb", "SP.DYN.LE00.IN", "health", "平均寿命", "歳",
       "生まれた赤ちゃんが平均で何歳まで生きられるかの見込み。", better="high", sdg=(3,)),
    _i("u5_mort", "wb", "SH.DYN.MORT", "health", "5歳未満の子どもの死亡率", "人/1000人",
       "生まれた子ども1000人のうち、5歳になる前に亡くなる人数。SDGsの目標は25以下。",
       better="low", sdg=(3,), scale="log"),
    _i("water", "wb", "SH.H2O.BASW.ZS", "health", "安全な飲み水を使える人の割合", "%",
       "少なくとも基本的な飲み水サービスを使える人の割合。", better="high", sdg=(6,)),
    _i("sanitation", "wb", "SH.STA.BASS.ZS", "health", "トイレ(衛生設備)を使える人の割合", "%",
       "少なくとも基本的な衛生設備(トイレ)を使える人の割合。", better="high", sdg=(6,)),
    _i("undernourish", "wb", "SN.ITK.DEFC.ZS", "health", "栄養不足の人の割合", "%",
       "必要な食べ物のエネルギーが足りていない人の割合。", better="low", sdg=(2,)),
    _i("health_exp", "wb", "SH.XPD.CHEX.PC.CD", "health", "1人あたり医療費", "US$",
       "1人あたり1年間に使われる医療費。医療がどれだけ整っているかの目安。",
       better="high", sdg=(3,), decimals=0, scale="log"),

    # --- 教育・科学 ---
    _i("literacy", "wb", "SE.ADT.LITR.ZS", "education", "識字率(大人)", "%",
       "15歳以上で読み書きができる人の割合。", better="high", sdg=(4,)),
    _i("primary_done", "wb", "SE.PRM.CMPT.ZS", "education", "小学校の修了率", "%",
       "小学校を最後の学年まで修了した子どもの割合(100%をこえることもある)。", better="high", sdg=(4,)),
    _i("secondary", "wb", "SE.SEC.ENRR", "education", "中学・高校の就学率", "%",
       "中等教育(中学・高校)に通っている人の割合(総就学率。100%をこえることもある)。",
       better="high", sdg=(4,)),
    _i("tertiary", "wb", "SE.TER.ENRR", "education", "大学などへの進学率", "%",
       "大学・専門学校など高等教育に通う人の割合(総就学率)。", better="high", sdg=(4,)),
    _i("edu_exp", "wb", "SE.XPD.TOTL.GD.ZS", "education", "教育への支出(GDP比)", "%",
       "国が教育にGDPの何%を使っているか。", better="high", sdg=(4,)),
    _i("rnd", "wb", "GB.XPD.RSDV.GD.ZS", "education", "研究開発費(GDP比)", "%",
       "科学技術の研究開発にGDPの何%を使っているか。", better="high", sdg=(9,), decimals=2),
    _i("sci_articles", "wb", "IP.JRN.ARTC.SC", "education", "科学論文の数", "本/年",
       "1年間に発表された科学・技術の論文の数。その国の科学の力の目安。",
       better="high", sdg=(9,), decimals=0, scale="log"),

    # --- 平和・紛争 ---
    _i("conflict_deaths", "owid", "deaths-in-armed-conflicts-by-type:*", "peace",
       "武力紛争による死者", "人/年",
       "その国で起きた武力紛争(国家間・内戦・民間人への暴力などの合計)で亡くなった人の数。"
       "ウプサラ大学の紛争データ計画(UCDP)調べ。データがない国・年は対象の紛争がなかったことが多い。",
       better="low", sdg=(16,), decimals=0, scale="log", org="ウプサラ大学 UCDP / Our World in Data"),
    _i("homicide", "wb", "VC.IHR.PSRC.P5", "peace", "殺人の発生率", "件/10万人",
       "人口10万人あたりの殺人の件数。治安の目安。", better="low", sdg=(16,), scale="log"),
    _i("military", "wb", "MS.MIL.XPND.GD.ZS", "peace", "軍事費(GDP比)", "%",
       "国がGDPの何%を軍事に使っているか(ストックホルム国際平和研究所 SIPRI 調べ)。", decimals=2),
    _i("women_parl", "wb", "SG.GEN.PARL.ZS", "peace", "女性議員の割合", "%",
       "国会の議席のうち女性がしめる割合。ジェンダー平等の目安。", better="high", sdg=(5,)),
    _i("refugees_out", "unhcr", "refugees:coo", "peace", "その国から逃れた難民", "人",
       "戦争や迫害でその国から国外へ逃れた難民の数(UNHCR 調べ)。", better="low", sdg=(16,),
       decimals=0, scale="log"),
    _i("refugees_in", "unhcr", "refugees:coa", "peace", "受け入れている難民", "人",
       "その国が受け入れている難民の数(UNHCR 調べ)。", sdg=(10, 17), decimals=0, scale="log"),

    # --- 人間開発(UNDP) ---
    _i("hdi", "undp", "hdi", "human", "人間開発指数(HDI)", "",
       "健康(寿命)・教育(学ぶ年数)・所得を組み合わせた、人間らしい豊かさの指数(0〜1)。1に近いほど高い。",
       better="high", sdg=(1, 3, 4, 8), decimals=3, org="UNDP"),
    _i("ihdi", "undp", "ihdi", "human", "不平等を考えたHDI", "",
       "国の中の格差を差し引いたHDI。HDIとの差が大きいほど、豊かさが一部の人に偏っている。",
       better="high", sdg=(10,), decimals=3, org="UNDP"),
    _i("gii", "undp", "gii", "human", "ジェンダー不平等指数(GII)", "",
       "女性の健康・政治や教育への参加・働く機会の男女差(0〜1)。0に近いほど平等。",
       better="low", sdg=(5,), decimals=3, org="UNDP"),
    _i("phdi", "undp", "phdi", "human", "地球への負担を考えたHDI", "",
       "CO₂排出や資源の使いすぎを差し引いたHDI。豊かさと地球環境の両立の目安。",
       better="high", sdg=(12, 13), decimals=3, org="UNDP"),
    _i("mys", "undp", "mys", "human", "平均就学年数(大人)", "年",
       "25歳以上の人が、これまでに学校で学んだ年数の平均。", better="high", sdg=(4,), org="UNDP"),
    _i("eys", "undp", "eys", "human", "予想就学年数(子ども)", "年",
       "いま学校に入る子どもが、学校で学ぶと見込まれる年数。", better="high", sdg=(4,), org="UNDP"),
    _i("gnipc", "undp", "gnipc", "human", "1人あたり国民総所得(GNI)", "US$(2021年PPP)",
       "国民が1年間に得た所得を人口で割り、物価の違いをならしたもの。", better="high", sdg=(8, 10),
       decimals=0, scale="log", org="UNDP"),
    _i("mmr", "undp", "mmr", "human", "妊産婦死亡率", "人/10万出生",
       "赤ちゃん10万人が生まれるあいだに、妊娠・出産が原因で亡くなる母親の数。SDGsの目標は70未満。",
       better="low", sdg=(3, 5), decimals=0, scale="log", org="UNDP"),

    # --- 歴史のデータ(大学の長期研究データ) ---
    _i("pop_hist", "owid", "population:population_historical", "history", "人口の歴史", "人",
       "紀元前1万年から現在までの人口の推計。農業・産業革命・医療の進歩で人口がどう増えたかがわかる。",
       decimals=0, scale="log", forecast=False, org="HYDE / 国連 / Our World in Data(オックスフォード大)"),
    _i("gdp_long", "owid", "gdp-per-capita-maddison:gdp_per_capita", "history",
       "1人あたりGDPの歴史", "国際ドル(2011年)",
       "西暦1年からの豊かさの推計。産業革命のあと、国によって差が大きく開いたことがわかる。",
       better="high", decimals=0, scale="log", forecast=False, org="フローニンゲン大学 Maddison Project"),
    _i("life_long", "owid", "life-expectancy:life_expectancy_0", "history", "平均寿命の歴史", "歳",
       "1543年からの平均寿命の推計。昔は子どもの死亡が多く、平均寿命は30〜40歳ほどだった。",
       better="high", forecast=False, org="Our World in Data(オックスフォード大)/ 国連"),
    _i("child_long", "owid", "child-mortality:child_mortality_rate", "history", "子どもの死亡率の歴史", "%",
       "5歳になる前に亡くなる子どもの割合(1751年〜)。200年前はどの国でも3〜4割をこえていた。",
       better="low", forecast=False, org="Gapminder / 国連 / Our World in Data"),
    _i("democracy", "owid", "electoral-democracy-index:electdem_vdem__estimate_best", "history",
       "民主主義の度合い(選挙民主主義指数)", "",
       "自由で公正な選挙・表現の自由などをもとにした民主主義の度合い(0〜1, 1789年〜)。1に近いほど民主的。",
       better="high", sdg=(16,), decimals=2, forecast=False, org="ヨーテボリ大学 V-Dem 研究所"),
    _i("co2_long", "owid", "co2-emissions-per-capita:emissions_total_per_capita", "history",
       "1人あたりCO₂排出の歴史", "t/人",
       "1750年からの1人あたりCO₂排出量。産業革命でどの国から排出が増えたかがわかる。",
       better="low", sdg=(13,), decimals=2, forecast=False, org="Global Carbon Project / Our World in Data"),

    # --- 国連 SDG Global Database(公式 SDG 指標)---
    _i("un_social_prot", "unsdg", "SI_COV_BENFTS|Sex=BOTHSEX", "economy", "社会保障を受けられる人の割合", "%",
       "年金・子ども手当・失業手当など、少なくとも1つの社会保障を受けられる人の割合(SDG 1.3.1)。",
       better="high", sdg=(1,), org="国連 SDG Global Database(ILO)"),
    _i("un_food_insec", "unsdg", "AG_PRD_FIESMS|Age=ALLAGE/15+;Location=ALLAREA;Sex=BOTHSEX", "health",
       "食べ物が足りない不安がある人の割合", "%",
       "お金などが足りず、十分な食べ物を手に入れられない不安がある"
       "(中程度〜重度の食料不安)人の割合(SDG 2.1.2)。",
       better="low", sdg=(2,), org="国連 SDG Global Database(FAO)"),
    _i("un_tb", "unsdg", "SH_TBS_INCD", "health", "結核にかかる人の数", "人/10万人",
       "1年間に新しく結核にかかる人の数(人口10万人あたり)。"
       "結核は今も世界で多くの人が亡くなる感染症(SDG 3.3.2)。",
       better="low", sdg=(3,), decimals=0, scale="log", org="国連 SDG Global Database(WHO)"),
    _i("un_preprimary", "unsdg", "SE_PRE_PARTN|Sex=BOTHSEX", "education",
       "小学校入学前の教育を受ける子どもの割合", "%",
       "小学校に入る1年前に、幼稚園・保育所などで学んでいる子どもの割合(SDG 4.2.2)。",
       better="high", sdg=(4,), org="国連 SDG Global Database(UNESCO)"),
    _i("un_child_marriage", "unsdg", "SP_DYN_MRBF18", "people", "18歳未満で結婚した女性の割合", "%",
       "20〜24歳の女性のうち、18歳になる前に結婚した人の割合"
       "(SDG 5.3.1)。子どもの結婚は教育や健康の機会をうばう。",
       better="low", sdg=(5,), org="国連 SDG Global Database(UNICEF)"),
    _i("un_safe_sanitation", "unsdg", "SH_SAN_SAFE|Location=ALLAREA", "health",
       "安全に管理されたトイレを使える人の割合", "%",
       "排せつ物が安全に処理されるトイレを使える人の割合(SDG 6.2.1)。「基本的なトイレ」より厳しい基準。",
       better="high", sdg=(6,), org="国連 SDG Global Database(WHO・UNICEF)"),
    _i("un_clean_cooking", "unsdg", "EG_EGY_CLEAN|Location=ALLAREA", "climate",
       "きれいな燃料で料理できる人の割合", "%",
       "ガスや電気など、けむりの少ない燃料で料理できる人の割合(SDG 7.1.2)。まきや炭のけむりは健康に悪い。",
       better="high", sdg=(7,), org="国連 SDG Global Database(WHO)"),
    _i("un_neet", "unsdg", "SL_TLF_NEET|Age=15-24;Sex=BOTHSEX", "economy",
       "学校にも仕事にも行っていない若者の割合", "%",
       "15〜24歳のうち、学校にも仕事にも職業訓練にも行っていない人の割合(SDG 8.6.1)。",
       better="low", sdg=(8,), org="国連 SDG Global Database(ILO)"),
    _i("un_4g", "unsdg", "IT_MOB_4GNTWK", "economy", "4Gの電波が届く人の割合", "%",
       "少なくとも4Gの携帯電話の電波が届く場所に住む人の割合(SDG 9.c.1)。",
       better="high", sdg=(9,), org="国連 SDG Global Database(ITU)"),
    _i("un_slum", "unsdg", "EN_LND_SLUM|Location=URBAN", "people", "スラムに住む都市人口の割合", "%",
       "都市に住む人のうち、安全な水やトイレ、しっかりした家がない地域(スラム)に住む人の割合(SDG 11.1.1)。",
       better="low", sdg=(11,), org="国連 SDG Global Database(UN-Habitat)"),
    _i("un_material", "unsdg", "EN_MAT_DOMCMPC|Type of product=ALP", "climate",
       "1人あたりの資源消費量", "t/人",
       "1人あたり1年間に国内で使われる資源(食料・木材・金属・鉱物・化石燃料)の量(SDG 12.2.2)。",
       better="low", sdg=(12,), scale="log", org="国連 SDG Global Database(UNEP)"),
    _i("un_disaster", "unsdg", "VC_DSR_MTMP", "geo", "災害による死者・行方不明者", "人/10万人",
       "自然災害で亡くなったり行方不明になったりした人の数(人口10万人あたり)(SDG 13.1.1)。",
       better="low", sdg=(1, 11, 13), decimals=2, scale="log", forecast=False,
       org="国連 SDG Global Database(UNDRR)"),
    _i("un_marine_kba", "unsdg", "ER_MRN_MPA", "nature", "海の重要な生物多様性地域の保護率", "%",
       "海の「生物多様性にとって重要な地域(KBA)」のうち、"
       "保護区で守られている面積の平均的な割合(SDG 14.5.1)。",
       better="high", sdg=(14,), org="国連 SDG Global Database(UNEP-WCMC)"),
    _i("un_redlist", "unsdg", "ER_RSK_LST", "nature", "レッドリスト指数", "",
       "その国の生き物が、どれだけ絶滅の危機にあるかを表す指数"
       "(0〜1)。1なら絶滅のおそれがない、0ならすべて絶滅(SDG 15.5.1)。",
       better="high", sdg=(15,), decimals=3, org="国連 SDG Global Database(IUCN)"),
    _i("un_birth_reg", "unsdg", "SG_REG_BRTH|Age=<5Y", "peace", "出生が登録された子どもの割合", "%",
       "5歳未満の子どものうち、生まれたことが役所に登録されている割合"
       "(SDG 16.9.1)。登録がないと学校や医療を受けにくい。",
       better="high", sdg=(16,), org="国連 SDG Global Database(UNICEF)"),
    _i("un_broadband", "unsdg", "IT_NET_BBND|Type of speed=ANYS", "economy",
       "固定ブロードバンドの契約数", "件/100人",
       "光回線など、家庭の高速インターネット回線の契約数(100人あたり)(SDG 17.6.1)。",
       better="high", sdg=(17,), org="国連 SDG Global Database(ITU)"),

    # --- UNESCO 統計研究所(教育)---
    _i("uis_out_of_school", "uis", "ROFST.MOD.1", "education", "学校に通えていない子どもの割合(小学校)", "%",
       "小学校に通う年齢なのに、学校に通えていない子どもの割合(推計)。",
       better="low", sdg=(4,), org="UNESCO 統計研究所"),
    _i("uis_cr_lsec", "uis", "CR.2", "education", "中学校の修了率", "%",
       "中学校(前期中等教育)を修了する年齢の少し上の人のうち、実際に修了した人の割合(SDG 4.1.2)。",
       better="high", sdg=(4,), org="UNESCO 統計研究所"),
    _i("uis_cr_lsec_poor", "uis", "CR.2.Q1", "education", "中学校の修了率(最も貧しい20%の家庭)", "%",
       "所得がいちばん低い20%の家庭の子どもの中学校修了率。"
       "「最も豊かな20%」とくらべると、国の中の格差がわかる。",
       better="high", sdg=(4, 10), forecast=False, org="UNESCO 統計研究所"),
    _i("uis_cr_lsec_rich", "uis", "CR.2.Q5", "education", "中学校の修了率(最も豊かな20%の家庭)", "%",
       "所得がいちばん高い20%の家庭の子どもの中学校修了率。",
       better="high", sdg=(4,), forecast=False, org="UNESCO 統計研究所"),
]

INDICATOR_BY_ID = {x["id"]: x for x in INDICATORS}


def validate_catalog() -> list[str]:
    """カタログの整合性チェック。問題があればメッセージの list を返す(空なら OK)。"""
    errors: list[str] = []
    cat_ids = {c["id"] for c in CATEGORIES}
    goal_ns = {g["n"] for g in SDG_GOALS}
    seen: set[str] = set()
    for ind in INDICATORS:
        if ind["id"] in seen:
            errors.append(f"duplicate id: {ind['id']}")
        seen.add(ind["id"])
        if ind["category"] not in cat_ids:
            errors.append(f"{ind['id']}: unknown category {ind['category']}")
        if ind["better"] not in ("high", "low", None):
            errors.append(f"{ind['id']}: bad better {ind['better']}")
        if ind["scale"] not in ("linear", "log"):
            errors.append(f"{ind['id']}: bad scale {ind['scale']}")
        for n in ind["sdg"]:
            if n not in goal_ns:
                errors.append(f"{ind['id']}: unknown SDG goal {n}")
        if ind["source"] not in ("wb", "unhcr", "undp", "owid", "harvard", "epi", "ndgain", "unsdg", "uis"):
            errors.append(f"{ind['id']}: unknown source {ind['source']}")
        if ind["source"] == "owid" and ":" not in ind["code"]:
            errors.append(f"{ind['id']}: owid code must be '<slug>:<column>'")
        if not ind["explain"]:
            errors.append(f"{ind['id']}: missing explain")
    return errors
