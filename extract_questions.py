#!/usr/bin/env python3
"""
G検定問題集PDFから問題・解答・解説を抽出してquestions.jsonを生成するスクリプト
"""

import re
import json
import sys
import PyPDF2

PDF_PATH = "G_kentei.pdf"
OUTPUT_PATH = "questions.json"

# 章定義: (chapter_id, name, q_page_start, q_page_end, a_page_start, a_page_end)
# ページ番号はPDFの印刷ページ番号（1始まり）
CHAPTERS = [
    (1,  "人工知能とは",                   14, 16,  17, 23),
    (2,  "人工知能をめぐる動向",            24, 30,  31, 43),
    (3,  "機械学習の概要",                  44, 60,  61, 85),
    (4,  "ディープラーニングの概要",         86, 97,  98, 117),
    (5,  "ディープラーニングの要素技術",    118, 129, 130, 147),
    (6,  "ディープラーニングの応用例",      148, 167, 168, 203),
    (7,  "AIの社会実装に向けて",            204, 209, 210, 219),
    (8,  "AIに必要な数理・統計知識",        220, 223, 224, 233),
    (9,  "AIに関する法律と契約",            234, 239, 240, 249),
    (10, "AI倫理・AIガバナンス",            250, 255, 256, 269),
    (11, "総仕上げ問題",                    270, 337, 338, 397),
]


def get_pages_text(reader, p_start, p_end):
    """印刷ページ番号範囲のテキストを結合して返す"""
    parts = []
    for pnum in range(p_start, p_end + 1):
        idx = pnum - 1  # 0-based index
        if 0 <= idx < len(reader.pages):
            t = reader.pages[idx].extract_text()
            if t:
                parts.append(t)
    return "\n".join(parts)


def normalize_choices(text):
    """
    選択肢マーカー (A. / B\n. / A .) を CHOICE_X: に正規化する。
    パターン例:
      \n A.  text  →  \nCHOICE_A: text
      \n B.\n text →  \nCHOICE_B: text
      \n C\n. text →  \nCHOICE_C: text
    """
    # パターン: 行頭に来る "[A-D] ." or "[A-D]\n."
    text = re.sub(r'\n\s*([A-D])\s*\n?\s*\.\s*', r'\nCHOICE_\1: ', text)
    return text


def clean_choice_text(text):
    """選択肢テキスト内の改行・余分なスペースを除去して整形"""
    # 改行を空白に置換してから連続スペースを圧縮
    text = text.replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text)
    # 「A I」→「AI」のような連続英字の間の余分スペースは残す（意味を変えないため）
    return text.strip()


def parse_questions_from_text(raw_text):
    """
    正規化されたテキストから問題リストを抽出する。
    Returns: list of {number, text, choices{A,B,C,D}}
    """
    # 選択肢マーカーを正規化
    normalized = normalize_choices(raw_text)

    # 問題ブロックを分割: □□\tN. で始まり ➡ P... で終わる
    # □□\tN. の代わりに □□\tN. または行頭数字. でも対応
    # 実際のフォーマット: "□□\t15.\t レコメンデーション..."
    # → ブロック区切り: □□\t + 数字 + .
    block_pattern = re.compile(
        r'□□\s*\t\s*(\d+)\.\t?\s*(.*?)(?=□□|\Z)',
        re.DOTALL
    )

    questions = []
    for m in block_pattern.finditer(normalized):
        num = int(m.group(1))
        block = m.group(2)

        # block内をCHOICE_で分割
        parts = re.split(r'\nCHOICE_([A-D]):\s*', block)
        # parts[0] = 問題文
        # parts[1], parts[2] = letter, text  (交互)

        q_text_raw = parts[0]

        # 問題文の整形: ➡ P... 以降を除去
        q_text_raw = re.sub(r'➡\s*P\d+.*', '', q_text_raw, flags=re.DOTALL)
        # ページヘッダ行を除去
        q_text_raw = re.sub(r'\n\s*\n', ' ', q_text_raw)
        q_text = clean_choice_text(q_text_raw)

        if not q_text:
            continue

        choices = {}
        i = 1
        while i + 1 < len(parts):
            letter = parts[i]
            choice_raw = parts[i + 1]
            # ➡ P... 以降を除去
            choice_raw = re.sub(r'➡\s*P\d+.*', '', choice_raw, flags=re.DOTALL)
            choices[letter] = clean_choice_text(choice_raw)
            i += 2

        if len(choices) == 4 and q_text:
            questions.append({
                'number': num,
                'text': q_text,
                'choices': choices
            })

    return questions


def parse_answers_from_text(raw_text):
    """
    解答テキストから {問題番号: {answer, explanation}} を抽出する。
    フォーマット: "\t N.\tC\t ➡ P14\n解説文..."
    """
    answers = {}

    # 解答パターン: タブで区切られた番号・正解・参照ページ
    ans_pattern = re.compile(r'\t\s*(\d+)\.\s*\t([ABCD])\t')

    # より柔軟なパターンも試す（タブの数が違う場合）
    ans_pattern2 = re.compile(r'(?:^|\n)\s*(\d+)\.\s+([ABCD])\s+➡', re.MULTILINE)

    lines = raw_text.split('\n')
    current_num = None
    current_ans = None
    exp_lines = []

    i = 0
    while i < len(lines):
        line = lines[i]

        # パターン1: タブ区切り
        m = ans_pattern.search(line)
        if not m:
            m = ans_pattern2.match(line.strip()) if line.strip() else None
            # ans_pattern2 は先頭マッチなのでlineを使う
            m2 = ans_pattern2.match(line)
            if m2:
                m = m2

        if m:
            # 前の解答を保存
            if current_num is not None:
                exp = ' '.join(exp_lines).strip()
                exp = re.sub(r'\s+', ' ', exp)
                answers[current_num] = {'answer': current_ans, 'explanation': exp}

            current_num = int(m.group(1))
            current_ans = m.group(2)
            exp_lines = []
            i += 1
            continue

        if current_num is not None:
            stripped = line.strip()
            # ページヘッダ等をスキップ
            if re.search(r'（問題）|（解答）|第\d+章|解\s*答|第\d+章\s*\u3000', stripped) and len(stripped) < 30:
                i += 1
                continue
            if re.match(r'^\d+$', stripped) and len(stripped) <= 3:  # ページ番号
                i += 1
                continue
            if stripped:
                exp_lines.append(stripped)

        i += 1

    # 最後の解答を保存
    if current_num is not None:
        exp = ' '.join(exp_lines).strip()
        exp = re.sub(r'\s+', ' ', exp)
        answers[current_num] = {'answer': current_ans, 'explanation': exp}

    return answers


def main():
    print(f"PDFを読み込み中: {PDF_PATH}")

    try:
        reader = PyPDF2.PdfReader(PDF_PATH)
    except Exception as e:
        print(f"PDF読み込みエラー: {e}", file=sys.stderr)
        sys.exit(1)

    if reader.is_encrypted:
        result = reader.decrypt('')
        if result == 0:
            print("PDFの復号に失敗しました", file=sys.stderr)
            sys.exit(1)
        print("PDFを復号しました")

    print(f"総ページ数: {len(reader.pages)}")

    chapters_data = []
    total_questions = 0
    total_matched = 0

    for (ch_id, ch_name, q_start, q_end, a_start, a_end) in CHAPTERS:
        print(f"\n第{ch_id}章「{ch_name}」を処理中...")

        q_text = get_pages_text(reader, q_start, q_end)
        a_text = get_pages_text(reader, a_start, a_end)

        questions = parse_questions_from_text(q_text)
        answers = parse_answers_from_text(a_text)

        print(f"  問題抽出数: {len(questions)}, 解答抽出数: {len(answers)}")

        matched_questions = []
        for q in questions:
            num = q['number']
            if num in answers:
                matched_questions.append({
                    'id': f"{ch_id}-{num}",
                    'chapter_id': ch_id,
                    'number': num,
                    'text': q['text'],
                    'choices': q['choices'],
                    'answer': answers[num]['answer'],
                    'explanation': answers[num]['explanation']
                })
            else:
                print(f"  警告: 問{num}の解答が見つかりません")

        print(f"  マッチング済み: {len(matched_questions)}/{len(questions)}")
        total_questions += len(questions)
        total_matched += len(matched_questions)

        chapters_data.append({
            'id': ch_id,
            'name': ch_name,
            'questions': matched_questions
        })

    output = {'chapters': chapters_data}

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n=== 完了 ===")
    print(f"総問題数: {total_questions}, マッチング済み: {total_matched}")
    print(f"出力ファイル: {OUTPUT_PATH}")

    print("\n章別問題数:")
    for ch in chapters_data:
        print(f"  第{ch['id']}章「{ch['name']}」: {len(ch['questions'])}問")


if __name__ == '__main__':
    main()
