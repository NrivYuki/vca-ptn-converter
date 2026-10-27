# JOB データと PTN データ：メーカー別の定義と変換の考え方

VCA（OMA / DCS）の周辺で目にする「JOB データ」「PTN データ」について、メーカーごとの定義と、VCA・SVG・DXF との変換の考え方をまとめたものです。

> **この文書の前提**
>
> - この文書は、インターネット上で公開されている情報だけで作成しています。情報源は次の 3 種類です
>   1. [OptiBoard](https://www.optiboard.com/)（眼鏡業界の英語フォーラム）の OMA 関連スレッド
>   2. 各メーカーの取扱説明書（メーカーや販売店のサイト、ManualsLib などで公開されているもの）
>   3. 用語の定義を定めた JIS T 7330（公開されているプレビューと改正案）
>   4. 日本医用光学機器工業会の「メガネ・ポータル」（用語集と、メガネができるまでの工程）
> - 実機が書き出した `.job` / `.ptn` ファイルの中身は確認していません。ファイルの内部形式はどのメーカーも公開しておらず、この文書でも扱えません
> - 取扱説明書に書かれていることは「定義」として、フォーラムの経験談は「報告」として、筆者の考えは「推測」として区別して書いています
> - 正確な情報は、機器メーカーや販売店に確認してください

## 用語と工程

この文書の用語は、眼鏡レンズの用語を定めた JIS T 7330（眼鏡レンズの用語）に合わせています。表記も JIS に合わせて「心取り」「玉形」とします。

**JIS T 7330 の用語**

| 用語 | 意味（JIS T 7330 の定義の要約） |
|---|---|
| 心取り点（CP） | 処方のプリズムなどがない状態で、光学中心・遠用部測定基準点・フィッティングポイントのいずれかが置かれるべき、眼鏡フレーム上の点。どれを使うかはレンズの種類で決まる（単焦点レンズは光学中心、累進屈折力レンズなどはフィッティングポイントなど） |
| 心取り点間距離（CD） | 一対のレンズの心取り点の間に求められる水平の距離。片眼ずつ（単眼）で指定することもある |
| 寄せ（心取り点の） | 玉形加工済レンズの、玉形のボックス中心から心取り点までのずれ |
| 心取り点位置 | 玉形の上で測った、ボックス中心から心取り点までの垂直・水平の距離と方向 |
| 玉形加工済レンズ | 玉形の大きさと形に縁ずり（外周を削る加工）されたレンズ |

**メガネができるまでの工程と、機器・データの対応**

工程の名前と説明は、日本医用光学機器工業会の「メガネ・ポータル」に合わせています。

| 工程 | 内容 | 使う機器（この文書での呼び方） | VCA・JOB・PTN との関係 |
|---|---|---|---|
| レンズメーター | レンズの中心を測り、印を付ける | レンズメーター | — |
| フレームトレース | フレームの形（玉形）を測る | トレーサー | 玉形のデータ（`TRCFMT`・`R`）。PTN にも JOB にも入る |
| レンズレイアウト設定 | 左右の目の幅と高さに合わせて、レンズの中心の位置を決める。JIS の心取り点の位置を決める作業にあたる | 心取り・ブロッカー | `IPD`・`OCHT` など。JOB にだけ入る |
| 玉すり／レンズ加工 | 玉形に合わせてレンズを削る。JIS の「縁ずり」にあたる | 加工機（玉すり機、エッジャー） | JOB や PTN を読み込んで削る |
| 枠入れ／組み立て | 削ったレンズをフレームにはめる | — | — |

- JIS T 7330 には「心取り」という作業そのものの定義はありません。この文書の「心取り・ブロッカー」は、取扱説明書の centering / blocking device の訳で、心取り点の位置を決めて、レンズに印や加工用の吸着盤を付ける機器を指します
- VCA のレコードとの対応（筆者の対応付け）：`IPD` は単眼の心取り点間距離、`OCHT` は心取り点の高さにあたります
- 定義の要約は、JIS T 7330 の改正案（2022 年版の案）と 2000 年版をもとにしています。2022 年版の本文と細部が異なる可能性があります

---

## 目次

1. [まとめ](#1-まとめ)
2. [Nidek（ニデック）](#2-nidekニデック)
3. [Huvitz](#3-huvitz)
4. [Essilor](#4-essilor)
5. [Weco](#5-weco)
6. [Briot](#6-briot)
7. [Hoya](#7-hoya)
8. [National Optronics](#8-national-optronics)
9. [確認できなかったメーカー](#9-確認できなかったメーカー)
10. [VCA との関係（推測）](#10-vca-との関係推測)
11. [SVG・DXF への変換](#11-svgdxf-への変換)
12. [出典](#12-出典)

---

## 1. まとめ

- 「JOB」と「PTN（パターン）」を別のデータとして分け、ファイルとしても扱うのは、調べた範囲では **Nidek だけ**です
- 他のメーカーにも「Job（ジョブ）」という言葉はあります。しかし、保存した形は「Pattern」「Shape」「Frame data」などと呼ばれ、`.ptn` のようなファイル形式は出てきません
- 調べた範囲では、Nidek・Huvitz・Weco・Essilor・National Optronics の機器に DCS（OMA）で入出力する機能があります。メーカーの違いを越えてデータをやり取りするときは、OMA が共通の形式になります

| メーカー | JOB にあたるもの | PTN にあたるもの | ファイルでの受け渡し |
|---|---|---|---|
| Nidek | JOB データ（形、加工条件、レイアウト） | PTN データ（形と、フレームに付く情報）。新しい加工機（Me 1200、LEXCE）は「形状データ」と呼ぶ | USB メモリに `.job` / `.ptn` |
| Huvitz | Job（Job Manager で管理） | Pattern は型板トレースのことで、保存する区分ではない | SD カードにジョブを保存。DCS（OMA）の読み書き |
| Essilor | Job（ID を付けて保存。トレーサー TESS は 200 件） | 区別なし（形も Job として ID で呼び出す） | TESS は RS-232・LAN で、OMA のプロトコルに対応 |
| Weco | Job（jobs base） | Pattern / Shape（pattern base、shape library）。主にブロッカー側で保存 | OMA でやり取り。ファイル形式の記載なし |
| Briot | Job（データベース） | Pattern / Shape（データベース、shape base） | サーバーからジョブや形を受け取る。ファイル形式の記載なし |
| Hoya | 番号（1〜500）を付けたデータ。加工機 AE-3000 は 500 ジョブまで | 区別なし | トレーサーから加工機・メモリーボックス・PC ソフトへ転送 |
| National Optronics | Job（ジョブ番号で外部から取り込む） | 区別なし | OMA でトレーサー・ブロッカー・ホストから受け取る |

## 2. Nidek（ニデック）

### 取扱説明書での定義

**JOB と PTN に入る項目**（ME-1000 と ICE 900 の取扱説明書より）

| 項目 | JOB | PTN（ICE 900） | PTN（ME-1000） |
|---|:-:|:-:|:-:|
| 玉形（トレースデータ） | ○ | ○ | ○ |
| FPD（左右の玉形の中心間の距離。DBL から求められる） | ○ | ○ | ○ |
| 穴の位置 | ○ | 記載なし | ○ |
| サイズ補正（玉形を少し大きく・小さくする量） | ○ | ○ | 記載なし |
| レンズの素材・種類 | ○ | ○ | 記載なし |
| フレームの種類（フルリム、ナイロール、ツーポイントなど） | ○ | ○ | 記載なし |
| 研磨・面取りの設定 | ○ | ○ | 記載なし |
| レイアウトの方式（パッシブ／アクティブ） | ○ | ○ | 記載なし |
| **装用者ごとのレイアウト（PD、光学中心の高さなど）** | **○** | **×** | **×** |

- **違いは最後の行です。** PTN は「よく使うフレームの形と、それに付く条件」、JOB は「それに装用者ごとのレイアウトを加えた、1 件の注文分」です
- PTN にどこまで入るかは機種によって違います。ME-1000 の PTN は形・FPD・穴の位置だけで、素材などは JOB にしか入りません
- JOB の欄の○は推定です。取扱説明書は JOB の中身を「トレースデータ、すべての加工条件、レイアウト情報」（ICE 900）、「形、加工条件、レイアウト（レンズ素材を含む）」（ME-1000）としか書いていないため、PTN の項目はすべて JOB にも含まれると判断しました
- 「パッシブ／アクティブ」は取扱説明書の用語で、レイアウトの方式を指すとみられますが、詳しい意味は確認できていません

**ME-1000（加工機）の取扱説明書**より、そのほかの記述：

- パターンデータとジョブデータは別々に保存され、合わせて 2000 件まで保存できる
- 目的は、よく加工する形を登録しておき、毎回トレースしなくて済むようにすること
- 形を読み込む元は「外部通信（EXTERN）」「JOB メモリ」「PTN メモリ」から選ぶ

**ICE 900（ブロッカー）の取扱説明書**より、そのほかの記述：

- PTN は、ツーポイントなど繰り返し使うフレームの形を保存するためのもの
- PTN 番号は「銘柄名 - 番号」の形式で、ハイフンを含めて最大 16 桁
- 銘柄名がそのままフォルダ名になる。フォルダがなければ自動で作られる
- `JOB_DATA` と `TMP_DATA` は名前の決まったフォルダ
- 本体の保存容量は、フォルダ 500 個、1 フォルダあたり 500 件、合計 30,000 件まで

### 機種ごとの扱い（取扱説明書より）

| 機種 | 種類 | JOB / PTN の扱い |
|---|---|---|
| ICE 900 | ブロッカー | JOB と PTN の両方を保存できる。USB メモリへ移動・バックアップできる。VCA サーバーから JOB を受け取れる |
| ICE-1000 | ブロッカー | USB メモリの JOB データ（または PTN データ）を読み込んで表示する。番号は「（メーカー）-（ファイル番号）」の形式 |
| ICE-9000 | ブロッカー | 加工機（ME-1000、LEX-1000）に JOB を渡す側として働く |
| ICE mini | ブロッカー | 保存するときに、番号の付け方で JOB か PTN（登録した形）かを選ぶ。VCA 方式ではサーバーから JOB を受け取り、ブロッカー端末としてだけ働く |
| ME-1000 | 加工機 | JOB と PTN を別々に保存する（上の表のとおり）。通信方式は STANDARD・LAN・VCA（PRESET / AUTO）・VCA-B など |
| LEX-1000 | パターンレス加工機 | 「PTN」という言葉は使わない。100 件の保存領域に、形・レイアウト・素材・フレームの種類などを入れる。JOB は ICE-1000 や ICE-9000 から受け取る |
| Me 1200 | 加工機 | 「形状データ（shape data）」と「加工履歴データ」を保存する。形状データの中身はトレースデータ、FPD（DBL）、サイズ、パッシブ／アクティブ、レンズの素材と種類、フレームの種類、研磨・面取りで、ICE 900 の PTN と同じ。設定で PD と光学中心の高さも加えられる。番号は「銘柄名 - 番号」で最大 16 桁。銘柄名は英字を 1 文字以上含む 12 桁まで。足りない桁は番号の先頭を 0 で埋める（例：NIDEK-12 → NIDEK-0000000012）。銘柄名のない番号は Others フォルダに入る。保存できるのは 1 銘柄 500 件、500 銘柄、合計 20,000 件まで。加工後のデータは加工履歴フォルダに自動で保存され、形状データに変えられる。JOB は ICE 1000 から JOB コードで受け取る。通信方式は N-LAN・VCA-B・VCA-C |
| LEXCE Trend / Trend8 | パターンレス加工機 | JOB と PTN の区別がなく、「形状データ（shape data）」だけを保存する。中身は玉形、FPD、DBL、PD、1/2PD、光学中心の高さ、サイズ、フレームカーブ、周長、溝の幅と深さ、レンズの素材と種類、フレームの種類、加工の方式、研磨、レイアウトの方式（パッシブ／アクティブ）、面取り、穴あけ、縁の加工の種類で、レイアウトまで含む。名前は「銘柄名-番号」で 16 文字（ハイフンを含む）。銘柄名は英字を 1 文字以上含み、ハイフンを含まない 12 文字まで。足りない桁は番号の先頭を 0 で埋める（例：NIDEK-0000001234）。銘柄名を付けないときは、英字もハイフンも含まない 16 桁の数字にする。保存できるのは 500 銘柄、合計およそ 20,000 件まで。USB メモリへのバックアップ・復元・追加ができる。サーバーやブロッカーとは Ethernet でやり取りし、通信方式は N-LAN・VCA-B・VCA-C |
| LE-700 | 加工機 | 「形状データ」として約 20,000 件を銘柄別フォルダで保存。USB メモリへのバックアップと復元ができる |
| LT-980 | トレーサー | 自分では保存せず、トレースしたデータをサーバーへ送る（STD、VCA、NIDEK LAN） |

LE-1000、LT-1200、ICE-1500 などの取扱説明書は入手できず、確認していません。

新しい加工機の Me 1200 では「PTN」という言葉を使わず、同じ中身を「形状データ」と呼んでいます。さらに新しい LEXCE では、形状データにレイアウトまで入り、JOB と PTN の区別そのものがなくなっています。

### OptiBoard での報告（OMA → PTN / JOB）

- OMA ファイルの拡張子を `.ptn` に変えるだけで ICE-1000 が読み込んだ（2022 年）
- ファイル名は先頭を 0 で埋めて 16 桁にする。例：`0000000000123456.ptn`。フォルダ名を桁数に含めてもよい（2022・2023 年）
- `JOB_DATA` フォルダに置く場合は、拡張子を `.job` にする（2023 年）
- 「改名しても読まなかった」という報告もある。正常な PTN が約 16 KB、OMA が約 11 KB と大きさが違った。この件には回答がついていない（2023 年）
- 「ICE を VCA ファイルを読む設定にするほうが簡単」という意見もある（2023 年）
- 販売店 Canadian Optical の手順書（LT900、M1000 向け）にも同じ手順がある。USB メモリに `S1` などのフォルダを作り、`S1-0000000152152.OMA` のような 16 桁の名前にして、拡張子を `.PTN` に変える

## 3. Huvitz

取扱説明書（HPE-810、CPE-4000、CFR-4000、HBK-7000S）より：

- **Job**：Job Manager でジョブを管理する。区分は次のとおり
  - Waiting Job：トレーサーやオートブロッカーから受け取ったばかりのジョブ
  - Working Job：加工中・編集中のジョブ
  - Completed Job：加工を終えたジョブ
  - Saved Job List：SD カードに保存したジョブ
  - 電源を切ると、SD カードに保存したもの以外は消える
- **Pattern**：型板（パターン）をトレースすることを指す言葉で、保存の区分ではない。CPE-4000 には「Frame/Pattern Data」を選ぶボタンがあり、直近のトレース結果を呼び出す
- CPE-4000 は、数百件のフレームを本体のメモリに保存できる
- オートブロッカー HBK-7000S は、本体メモリまたは SD カードのジョブデータから作業を始められる
- トレーサー CFR-4000 は DCS v3.07 に対応。出力の点数や形式（ASCII 絶対値など）を選べる
- HPE-410 のカタログには「DCS（OMA）ファイルを変換なしで直接読み込める」とある

OptiBoard（CAB4000 のスレッド、2019 年）では、規格にない `TRCFMT=5` や独自ラベル（`P_FPD`、`FTYPE` など）を送ってくる設定があったと報告されています。回答は「標準の形式 1〜4 に設定せよ」でした。

## 4. Essilor

取扱説明書（Neksia 550 / 米国名 KAPPA Special Edition）の用語集より：

- **Job**：1 組の眼鏡を作るための、トレーサー、心取り・ブロッキング、加工機での一連の作業。形状管理の画面で ID を付けて保存できる
- **ID**：ジョブの識別子。英数字で、重複しない
- 加工機で形を呼び出す方法は 3 つ：作業中のジョブを呼ぶ／トレーサーに保存した形を ID で呼ぶ／バーコードで呼ぶ
- PTN にあたる区別はなく、保存した形も Job として ID で扱う

取扱説明書（TESS トレーサー）より：

- 本体に 200 件のジョブを保存できる。USB メモリを使って、ソフトの更新や情報の書き出し・読み込みができる
- トレーサーと加工機の間で作業中のジョブだけをやり取りする使い方もあり、その場合ジョブは保存されない
- 接続は RS-232 と RJ-45（LAN）。シリアル通信の設定に「OMA と PC のプロトコル」がある。Topcon の加工機用のプロトコルも選べる

## 5. Weco

取扱説明書（E.3、E.6 / E.6 S.line、Edge 580 / 550、CAD III）とメーカーのカタログより：

- **ジョブ（Job）と形（Pattern / Shape）を分けて保存する**。保存する場所は機種によって違い、新しい機種ではブロッカー側（C.4・C.5・C.6）に大きな保存領域がある
- 機器どうしのやり取りは OMA が基本で、Nidek の `.ptn` / `.job` のようなファイル形式は出てこない

| 機種 | 種類 | ジョブと形の扱い |
|---|---|---|
| E.3 | 加工機 | 「ジョブの保存領域（jobs base）」と「形の保存領域（pattern base / shape base）」が別にある。ジョブは作ったときや呼び出したときに自動で保存され、加工が終わると消える。加工した形は自動で形の保存領域に入る。保存したジョブやパターンのほか、サーバーにあるジョブも呼び出せる。OMA ポートを持ち、ジョブを OMA サーバーへ送れる |
| E.6 / E.6 S.line | 加工機 | ジョブ番号でジョブを呼び出す。形はブロッカーやトレーサーで作り、OMA サーバーなどから受け取る。設定画面で OMA の版を選べる。加工機の中の形の保存領域についての記述はない |
| Edge 580 / 550 | 加工機 | 外部のサーバーにつないで形のデータを受け取る。ジョブ番号を使う。仕様に「ネットワーク接続」がある。形の保存領域についての記述はない |
| CAD III | 心取り・ブロッカー | 取扱説明書は 2000 年版。ジョブ番号は、メモリーカード SM200 では 1〜234、PC ソフト Optolab IV では 1〜999,999。形はトレーサーでトレースし、番号で呼び出す。接続はカレントループか RS-232 で、OMA の記述はない |
| C.4 | 心取り・ブロッカー | 「10,000 の形と 5,000 のジョブ」を保存できる（カタログ）。USB で最大 100 ブランドのフレームデータを読み込める |
| C.5 | 心取り・ブロッカー | 「ジョブと形の大きなデータベース」を持つ（カタログ） |
| C.6 | 心取り・ブロッカー | 形（パターン、穴あけ付きの形など）を 5,000 または 10,000 件まで保存でき、検索できる。ブロッカーから加工機へ自動でデータを送る（E.6 S.line のカタログ） |
| t6 | トレーサー | OMA（VCA 規格 3.10）に対応。RS-232、LAN、Wi-Fi（オプション）で通信する（E.6 S.line のカタログ） |

- カタログの互換表では、古い機種（CAD III、Trace 2 HC など）と新しい加工機をつなぐときに「CL-OMA-Box」を使うとされている
- 形の変更には、ShapeMaker などのソフトや、ブロッカーの形の変更機能を使う（カタログ。OptiBoard でも CAD 5 などの専用ソフトが必要という話がある）

## 6. Briot

取扱説明書（Emotion、Couture）より：

- OptiBoard（2015 年）では、Briot Emotion は Weco E.3 と同じ機械だとされている。取扱説明書の構成もほぼ同じ
- **Emotion（加工機）**：ジョブはデータベースから呼び出すほか、サーバーのデータベースからも呼び出せる。パターンもデータベースから呼び出す。目次に「形の保存領域（shape base）に形を保存する」項目がある。Digiform という機能で形を変更し、新しいパターンを作れる
- **Couture（加工機）**：外部のサーバーにつないで形のデータを受け取り、ジョブ番号を開いて加工する。加工機の中に形を保存する仕組みについての記述はない

## 7. Hoya

取扱説明書（GT-3000 トレーサー、英語版）より：

- トレースした形に番号（1〜500）を付けて送り、加工機 AE-3000 のメモリーに保存する。AE-3000 は、トレーサーから受け取ったデータやバーコードで読んだデータを、最大 500 ジョブまで保存できる
- メモリーボックス MB-5 にも番号を付けて保存できる。番号はバーコードでも読み取れる
- PC ソフト HIT-7 にもデータを送れる。HIT-7 には、メーカー名・フレーム名・サイズ・素材を付けて形を保存する画面がある
- 通信ポートは RS-232C が 2 つ、USB が 1 つ。取扱説明書に OMA の記述はない
- OptiBoard では、PC のソフト（DigitalTrace など）を使って OMA として保存する方法が紹介されている

## 8. National Optronics

取扱説明書（7E 加工機）より：

- ジョブ番号を入れて、トレーサー・ブロッカー・ホストからジョブを取り込む。番号はバーコードでも読める
- 通信は OMA。初期化のレベル（Full / None）を設定でき、通信の記録を表示できる
- 加工機の中に形を保存する仕組みについての記述はない

## 9. 確認できなかったメーカー

Topcon、Takubo、Santinelli については、JOB や PTN を定義した取扱説明書を見つけられませんでした。

- Santinelli は、自社のサポートサイトで Nidek 機（LT-980 など）の取扱説明書を公開しており、Nidek 機を扱う販売会社とみられます。そのため、定義は Nidek と同じだと考えられます（推測）

## 10. VCA との関係（推測）

ここからは、上の情報をもとにした筆者の推測です。

- OMA を改名しただけのファイルを Nidek 機が読めるということは、**Nidek 機は `.ptn` / `.job` の中身として VCA のテキストを受け付ける**と考えられます
- そうだとすると、JOB と PTN の違いは、中身の形式ではなく、**拡張子と置き場所によって、どのラベルまで読むか**の違いだと考えられます

| 区分 | 読むと考えられる VCA のレコード |
|---|---|
| PTN | 形（`TRCFMT` / `R` / `A`、`ZFMT` / `Z`）、`DBL`、`HBOX` / `VBOX` / `CIRC`、穴（`DRILLE` など）、素材やフレームの種類（機種による。2 章の表を参照） |
| JOB | PTN の内容に加えて、レイアウト（`IPD`、`NPD`、`OCHT`、`SEGHT` など）と加工条件 |

**確認できていないこと**：

- 機器が自分で書き出した `.ptn` / `.job` が VCA のテキストかどうか。11 KB と 16 KB の違いからすると、独自のラベルが加わっているか、別の形式の可能性があります
- 改名したファイルを、どの機種・どのソフトの版まで読めるか

## 11. SVG・DXF への変換

### 変換できるか

| 変換元 | SVG / DXF への変換 | 理由 |
|---|---|---|
| VCA（OMA） | できる | 公開された規格なので、形を座標に直せる |
| OMA を改名して作った JOB / PTN | できる | 中身は VCA と同じ |
| 機器が書き出した JOB / PTN | 不明 | 内部形式が公開されていない。機器を VCA 出力に設定するか、Nidek VCA Converter（後述）で VCA に変えてから変換する |
| 他のメーカーの保存データ | 不明 | 同じく形式が公開されていない。各機器の DCS（OMA）出力を使う |

### VCA → SVG / DXF

形を失わずに変換できます。

1. 半径 r と角度 θ から、x = r cos θ、y = r sin θ で座標にする
2. 閉じた折れ線として出力する（SVG は `<path>`、DXF は `POLYLINE` または `LWPOLYLINE`）
3. 注意すること
   - SVG は y 軸が下向きなので反転する
   - 単位を mm と明記する（SVG は `viewBox` と幅・高さ、DXF は `$INSUNITS=4`）
   - 両眼を並べるときは `DBL` の分だけ離す
   - Z（サグ）は 2D の SVG には入らない

### SVG / DXF → VCA

条件つきでできます。

1. 曲線（ベジェ、円弧、スプライン）を細かい線分に直す
2. 補助線や穴の中から、外形の閉じた輪郭を 1 つ選ぶ
3. 外接箱の中心に移動する（VCA の半径は箱の中心が基準）
4. 中心から等角度で線を伸ばし、輪郭と交わる点までの距離を半径にする
5. 0° を 3 時の方向、反時計回り、正面から見た向きにそろえる
6. `HBOX`・`VBOX`・`CIRC` を、測り直した半径から計算し直す

**制約**：中心から見て輪郭と 2 回以上交わる形（内側にえぐれた形）は、等角度（`E`）では表せません。角度モード `C`（v3.09 以降）が必要ですが、対応した加工機はほとんどないとされています（OptiBoard、2013 年）。

### OptiBoard で名前が挙がったツール

いずれも本人や販売元の説明で、第三者が確認したものではありません。

| ツール | 内容 |
|---|---|
| [eeng/lens_protocol](https://github.com/eeng/lens_protocol)（Ruby、オープンソース） | OMA を SVG に出力できる |
| Optivision | DXF → OMA、OMA → PTN の変換。OMA → DXF はファイル次第 |
| NOVUM Edge | SVG と OMA を損失なく相互変換できると開発者が説明 |
| Nidek VCA Converter | トレース結果を PC に VCA として取り出すために勧められていた。ソフトの紹介サイトでは、Nidek の形式と VCA/OMA の間でトレースデータやジョブデータを変換すると説明されている（Nidek の公式情報ではない） |

## 12. 出典

### JIS

- JIS T 7330:2022 眼鏡レンズの用語（[日本規格協会のプレビュー、PDF](https://webdesk.jsa.or.jp/preview/pre_jis_t_07330_000_000_2022_j_ed10_ch.pdf)）
- JIS T 7330 改正案（[e-Gov パブリック・コメント、PDF](https://public-comment.e-gov.go.jp/pcm/download?seqNo=0000236017)）
- JIS T 7330:2000 眼鏡レンズの用語（[kikakurui.com](https://kikakurui.com/t7/T7330-2000-01.html)）

### メガネ・ポータル（日本医用光学機器工業会）

- [メガネ用語集](https://www.jmoia.jp/glasses/meganeportal/columns/eyeglassglossary.html)
- [メガネになるまで](https://www.jmoia.jp/glasses/meganeportal/video/video2.html)

### OptiBoard のスレッド

| スレッド | 時期 | 主な内容 |
|---|---|---|
| [.OMA file format](https://www.optiboard.com/forums/forum/optical-forums/general-optics-and-eyecare-discussion-forum/60468-oma-file-format) | 2015〜2022 年 | OMA ファイルの実例 |
| [OMA Trace File](https://www.optiboard.com/forums/forum/optical-forums/ophthalmic-optics/50353-oma-trace-file) | 2012〜2013 年 | 角度モード U / C、Z データ |
| [Help transfering OMA files to PTN for Santinelli tracers](https://www.optiboard.com/forums/forum/optical-forums/general-optics-and-eyecare-discussion-forum/73076-help-transfering-oma-files-to-ptn-for-santinelli-tracers) | 2022 年 | 改名で PTN にする方法、16 桁の名前 |
| [Nidek ICE-1000 How to convert OMA Files to PTN?](https://www.optiboard.com/forums/forum/optical-forums/general-optics-and-eyecare-discussion-forum/73906-nidek-ice-1000-how-to-convert-oma-files-to-ptn) | 2023 年 | `JOB_DATA` と `.job`、ファイルの大きさの違い |
| [how to receive vca data from an Nidek blocker](https://www.optiboard.com/forums/forum/conversation-and-fun/computer-and-software-help/68485-how-to-receive-vca-data-from-an-nidek-blocker) | 2018・2024 年 | ICE-9000 から JOB / PTN を取り出す試み |
| [Communication with OMA tracer](https://www.optiboard.com/forums/forum/optical-forums/general-optics-and-eyecare-discussion-forum/67768-communication-with-oma-tracer) | 2018 年 | ICE-1000 の形式 3（バイナリ差分） |
| [Trying to connect Huvitz AutoBlocker CAB4000](https://www.optiboard.com/forums/forum/optical-forums/ophthalmic-optics/69454-trying-to-connect-huvitz-autoblocker-cab4000-with-data-transmission-oma-protocol) | 2019 年 | 規格にない形式 5 |
| [Converting a Hoya tracer to OMA](https://www.optiboard.com/forums/forum/optical-forums/general-optics-and-eyecare-discussion-forum/62811-converting-a-hoya-tracer-to-oma) | 2016・2025 年 | Hoya トレーサーから OMA を保存 |
| [Looking for some software for remote tracer](https://www.optiboard.com/forums/forum/optical-forums/optical-and-ophthalmic-equipment/74303-looking-for-some-software-for-remote-tracer) | 2023 年 | Nidek VCA Converter などのソフト |
| [Is there a way for me to edge to an SVG File format yet?](https://www.optiboard.com/forums/forum/optical-forums/optical-and-ophthalmic-equipment/73704-is-there-a-way-for-me-to-edge-to-an-svg-file-format-yet) | 2023〜2025 年 | SVG / DXF との変換 |
| [ait weco e.3 vs coburn exxpert 8000](https://www.optiboard.com/forums/forum/optical-forums/ophthalmic-optics/58674-ait-weco-e-3-vs-coburn-exxpert-8000) | 2014〜2015 年 | Weco E.3 と Briot Emotion は同じ機械 |

### 取扱説明書・メーカー資料

- Nidek ME-1000 Operator's Manual（[usedsantinelli.com](https://usedsantinelli.com/wp-content/uploads/2014/06/ME1000-OME-H.pdf)）
- Nidek ICE 900 Operator's Manual（[ManualsLib](https://www.manualslib.com/manual/1226853/Nidek-Medical-Ice-900.html)）
- Nidek ICE-1000 Operator's Manual（[ManualsLib](https://www.manualslib.com/manual/1998375/Nidek-Medical-Ice-1000.html)）
- Nidek ICE mini Operator's Manual（[ManualsLib](https://www.manualslib.com/manual/1820869/Nidek-Medical-Ice-Mini.html)）
- Nidek LEX-1000 Operator's Manual（[ManualsLib](https://www.manualslib.com/manual/1254231/Nidek-Medical-Lex-1000.html)）
- Nidek LE-700 Operator's Manual（[ManualsLib](https://www.manualslib.com/manual/1251928/Nidek-Medical-Le-700.html)）
- Nidek Me 1200 Operator's Manual（[usedsantinelli.com、PDF](http://usedsantinelli.com/wp-content/uploads/2014/06/Me-1200-OME-44501-P912A-S.pdf)）
- Nidek LEXCE Trend / Trend8 Operator's Manual（[Scribd](https://www.scribd.com/document/768886163/LE021-OME-LE021-P902-B9)）
- Nidek LT-980 Operator's Manual（[vho.be](https://www.vho.be/media/e2/c4/1c/1737999527/6797c4a67cb7a-Handleiding_LT-980_Satellite_Tracer_-_ENG.pdf.pdf?ts=1737999527)）
- Canadian Optical, Quick Guide – Nidek（[PDF](https://canadianoptical.com/public_document/quickguide_nidek.pdf)）
- Huvitz HPE-810 User Manual（[PDF](https://ml-oc.com/media/pdf/HPE-810_USERS_MANUAL.pdf)）
- Huvitz CPE-4000 Operator's Manual（[PDF](https://arnamedical.ru/doc/pic/prod_huvitz/linses/CPE-4000.pdf)）
- Huvitz CFR-4000 Operator's Manual（[PDF](https://www.optiekxl.nl/mwdownloads/download/link/id/1983)）
- Huvitz HBK-7000S Operator's Manual（[ManualsLib](https://www.manualslib.com/manual/1928268/Huvitz-Hbk-7000s.html)）
- Essilor Neksia 550 / KAPPA Special Edition User Manual（[PDF](https://www.essilorinstrumentsusa.com/wp-content/uploads/2020/06/KAPPA-Special-Edition-User-Manual-US.pdf)）
- Essilor TESS User Manual（[ManualsLib](https://www.manualslib.com/manual/1456966/Essilor-Tess.html)）
- Weco E.3 Operation manual（[Scribd](https://www.scribd.com/document/777403474/Weco-E3-Operation-manual-FC00726)）
- Weco E.6 S.line / E.6 Operation manual（[ManualsLib](https://www.manualslib.com/manual/3779168/Weco-E-6-S-Line.html)）
- Weco Edge 580 / Edge 550 Manual（[ManualsLib](https://www.manualslib.com/manual/1801592/Weco-Edge-580.html)）
- Weco CAD III Operation Manual（[ManualsLib](https://www.manualslib.com/manual/1581405/Weco-Cad-Iii.html)）
- Weco E.6 S.line Brochure（[Visionix、PDF](https://www.visionix.com/wp-content/uploads/2022/03/BrochureEN-WECOE6SLine-ind10-0322-WEB-2.pdf)）
- Weco Export Catalogue 2017（[PDF](https://www.krak-optic.pl/wp-content/uploads/2017/07/WECOEXPORTCATALOGUE2017.pdf)）
- Briot Emotion Operation Manual（[ManualsLib](https://www.manualslib.com/manual/1290019/Briot-Emotion.html)）
- Briot Couture User Manual（[PDF](https://kinhmatdienbienphu.com/data/briot-couture-fc-00-1198-rev-02-en.pdf)）
- Hoya GT-3000 Operation Manual（[Scribd](https://www.scribd.com/doc/78844486/GT3000)）
- National Optronics 7E Edger User Manual（[PDF](https://www.nationaloptronics.net/download/7E/manual/7ExES-versaEnglishManualInsertRev1.03.pdf)）
- NIDEK VCA Converter（[software.informer](https://nidek-vca-converter.software.informer.com/)、Nidek の公式情報ではない）

---

この文書は個人がインターネット上の公開情報をまとめたもので、各メーカーとは関係ありません。製品名・会社名は各権利者に帰属します。記載内容の正確さは保証できません。実機で使う場合は、メーカーや販売店に確認してください。
