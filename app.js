// ここを Cloudflare Worker のURLに置き換えてください。
// 例: const API_BASE = "https://java-runner-proxy.xxxxx.workers.dev";
const API_BASE = "https://java-runner-proxy.ryuryu-dm0825.workers.dev";

const codeEl = document.getElementById("code");
const stdinEl = document.getElementById("stdin");
const outputEl = document.getElementById("output");
const runButton = document.getElementById("runButton");
const clearButton = document.getElementById("clearButton");

clearButton.addEventListener("click", () => {
  outputEl.textContent = "ここに実行結果が表示されます。";
});

runButton.addEventListener("click", async () => {
  const sourceCode = codeEl.value;
  const stdin = stdinEl.value;

  if (!API_BASE || API_BASE.includes("YOUR-WORKER-URL")) {
    outputEl.textContent = "設定エラー：frontend/app.js の API_BASE を Cloudflare Worker のURLに変更してください。";
    return;
  }

  runButton.disabled = true;
  outputEl.textContent = "実行中です... 少々お待ちください。";

  try {
    const res = await fetch(`${API_BASE}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_code: sourceCode,
        stdin,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      outputEl.textContent = data.error || "実行に失敗しました。";
      return;
    }

    let message = "";
    // message += `ステータス：${data.status || "不明"}\n`;
    // message += `実行時間：${data.time || "-"} 秒\n`;
    // message += `メモリ：${data.memory || "-"} KB\n`;
    // message += "\n";

    if (data.stdout) {
      message += data.stdout;
    }

    if (data.stderr) {
      message += "\n【実行時エラー】\n" + data.stderr + "\n";
    }

    if (data.compile_output) {
      message += "\n【コンパイルエラー】\n" + data.compile_output + "\n";
    }

    if (!data.stdout && !data.stderr && !data.compile_output) {
      message += "出力はありません。";
    }

    outputEl.textContent = message;
  } catch (error) {
    outputEl.textContent = "通信エラー：WorkerのURL、公開状態、CORS設定を確認してください。\n\n" + error.message;
  } finally {
    runButton.disabled = false;
  }
});
