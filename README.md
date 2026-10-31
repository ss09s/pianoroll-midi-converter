# PianoRoll MIDI Converter Ver.0.2

## 起動
`index.html` をブラウザで開くか、GitHub Pagesで公開します。

## 操作
1. 動画ファイルを選択し、読み込み完了を待ちます。
2. 動画を再生・シークして鍵盤が見えるフレームを選びます。
3. 鍵盤上端・下端を調整し「鍵盤境界を検出」。
4. 「ノーツ候補を検出」で色のある縦長領域を黄色枠で表示します。

## GitHub Pages
Publicリポジトリの直下に `index.html` と `README.md` を置き、Settings → Pages → Deploy from a branch → main / root を選択します。

## 制限
本版はフレーム表示、簡易鍵盤境界候補検出、簡易ノーツ候補抽出までです。MIDI出力、音程・時刻の確定、BPM・拍子検出、サステイン検出は未実装です。動画はブラウザ内で処理し、外部送信しません。
