// ここを Cloudflare Worker のURLに置き換えてください。
// 例: const API_BASE = "https://java-runner-proxy.xxxxx.workers.dev";
const API_BASE = "https://java-runner-proxy.ryuryu-dm0825.workers.dev";

const codeEditorEl = document.getElementById("codeEditor");
const outputEl = document.getElementById("output");
const runButton = document.getElementById("runButton");
const clearButton = document.getElementById("clearButton");
const addFileButton = document.getElementById("addFileButton");
const addPackageButton = document.getElementById("addPackageButton");
const deleteFileButton = document.getElementById("deleteFileButton");
const fileTabsEl = document.getElementById("fileTabs");
const projectTreeEl = document.getElementById("projectTree");
const activeFileNameEl = document.getElementById("activeFileName");
const mainClassEl = document.getElementById("mainClass");

let editor = null;
let monacoRef = null;

let files = [
  {
    path: "src/Main.java",
    content: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello Java");
    }
}`
  }
];

let packages = [];
let activeFileIndex = 0;
let selectedPackage = "";
let selectedTreeType = "file";
let draggingFilePath = "";
let dragOverPackage = null;

function saveCurrentFile() {
  if (!files[activeFileIndex]) return;
  files[activeFileIndex].content = editor ? editor.getValue() : files[activeFileIndex].content;
}

function getFileName(path) {
  return path.split("/").pop();
}

function getPackageFromPath(path) {
  if (!path.startsWith("src/")) return "";

  const parts = path.split("/");
  parts.shift();
  parts.pop();

  return parts.join(".");
}

function packageToPath(packageName) {
  const normalizedPackage = normalizePackageName(packageName);
  return normalizedPackage ? normalizedPackage.replace(/\./g, "/") + "/" : "";
}

function normalizeClassName(input) {
  let className = (input || "").trim().replace(/\s+/g, "");
  className = className.replace(/\.java$/, "");
  return className;
}

function normalizePackageName(input) {
  return (input || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.\.+/g, ".");
}

function isValidClassName(className) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className);
}

function isValidPackageName(packageName) {
  if (!packageName) return true;
  return /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(packageName);
}

function createClassTemplate(className, packageName) {
  const packageLine = packageName ? `package ${packageName};\n\n` : "";

  return `${packageLine}public class ${className} {

}`;
}

function createFilePath(className, packageName) {
  return `src/${packageToPath(packageName)}${className}.java`;
}

function updatePackageDeclaration(content, packageName) {
  let updatedContent = content || "";

  // 既存の package 文をいったん削除します。
  // 例：package com.example;
  updatedContent = updatedContent.replace(/^\s*package\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\s*;\s*/m, "");

  if (!packageName) {
    return updatedContent.trimStart();
  }

  return `package ${packageName};\n\n${updatedContent.trimStart()}`;
}

function moveFileToPackage(filePath, targetPackage) {
  saveCurrentFile();

  const file = files.find((item) => item.path === filePath);
  if (!file) return;

  const packageName = normalizePackageName(targetPackage || "");

  if (!isValidPackageName(packageName)) {
    alert("移動先のパッケージ名が正しくありません。");
    return;
  }

  const fileName = getFileName(file.path);
  const newPath = `src/${packageToPath(packageName)}${fileName}`;

  if (newPath === file.path) return;

  if (files.some((item) => item.path === newPath)) {
    alert(`${newPath} はすでに存在します。`);
    return;
  }

  file.path = newPath;
  file.content = updatePackageDeclaration(file.content, packageName);

  if (packageName && !packages.includes(packageName)) {
    packages.push(packageName);
  }

  if (fileName === "Main.java") {
    mainClassEl.value = packageName ? `${packageName}.Main` : "Main";
  }

  sortPackages();
  sortFiles();
  activeFileIndex = files.findIndex((item) => item.path === newPath);
  selectedPackage = packageName;
  selectedTreeType = "file";
  showActiveFile();
  outputEl.textContent = `${fileName} を ${packageName ? `src/${packageToPath(packageName)}` : "src直下"} に移動しました。`;
}

function sortFiles() {
  files.sort((a, b) => {
    if (a.path === "src/Main.java") return -1;
    if (b.path === "src/Main.java") return 1;
    return a.path.localeCompare(b.path, "ja");
  });
}

function sortPackages() {
  packages = [...new Set(packages)].sort((a, b) => a.localeCompare(b, "ja"));
}

function isFileInPackage(filePath, packageName) {
  const filePackage = getPackageFromPath(filePath);
  return filePackage === packageName || filePackage.startsWith(`${packageName}.`);
}

function selectPackage(packageName) {
  selectedPackage = normalizePackageName(packageName || "");
  selectedTreeType = selectedPackage ? "package" : "folder";
  renderProjectTree();
  updateDeleteButtonState();
}

function updateDeleteButtonState() {
  if (!deleteFileButton) return;

  if (selectedTreeType === "package" && selectedPackage) {
    deleteFileButton.textContent = "パッケージ削除";
    deleteFileButton.disabled = false;
    return;
  }

  deleteFileButton.textContent = "ファイル削除";
  deleteFileButton.disabled = files.length <= 1;
}

function deleteSelectedPackage() {
  const packageName = normalizePackageName(selectedPackage);

  if (!packageName) {
    alert("削除するパッケージを左のプロジェクト構成から選択してください。");
    return;
  }

  const affectedFiles = files.filter((file) => isFileInPackage(file.path, packageName));
  const affectedPackages = packages.filter((pkg) => pkg === packageName || pkg.startsWith(`${packageName}.`));

  if (affectedFiles.length >= files.length) {
    alert("すべてのJavaファイルが消えるため削除できません。先に別の場所へファイルを移動してください。");
    return;
  }

  const fileMessage = affectedFiles.length
    ? `\n\nこのパッケージ内のJavaファイルも削除されます。\n${affectedFiles.map((file) => `・${file.path}`).join("\n")}`
    : "";

  if (!confirm(`${packageName} パッケージを削除しますか？${fileMessage}`)) {
    return;
  }

  packages = packages.filter((pkg) => !affectedPackages.includes(pkg));
  files = files.filter((file) => !affectedFiles.includes(file));

  sortPackages();
  sortFiles();
  activeFileIndex = Math.min(activeFileIndex, files.length - 1);
  if (activeFileIndex < 0) activeFileIndex = 0;
  selectedPackage = "";
  selectedTreeType = "file";
  showActiveFile();
  outputEl.textContent = `${packageName} パッケージを削除しました。`;
}

function setActiveFileByPath(path) {
  saveCurrentFile();

  const index = files.findIndex((file) => file.path === path);
  if (index === -1) return;

  activeFileIndex = index;
  selectedPackage = getPackageFromPath(files[index].path);
  selectedTreeType = "file";
  showActiveFile();
}

function renderTabs() {
  fileTabsEl.innerHTML = "";

  files.forEach((file, index) => {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = "fileTab" + (index === activeFileIndex ? " active" : "");
    tabButton.textContent = getFileName(file.path);
    tabButton.title = file.path;

    tabButton.addEventListener("click", () => {
      saveCurrentFile();
      activeFileIndex = index;
      selectedPackage = getPackageFromPath(file.path);
      selectedTreeType = "file";
      showActiveFile();
    });

    fileTabsEl.appendChild(tabButton);
  });

  updateDeleteButtonState();
}

function buildProjectTree() {
  const root = {
    type: "folder",
    name: "project",
    children: new Map(),
  };

  function ensureFolder(parent, name, packageName) {
    if (!parent.children.has(name)) {
      parent.children.set(name, {
        type: "folder",
        name,
        packageName,
        children: new Map(),
      });
    }

    return parent.children.get(name);
  }

  const srcFolder = ensureFolder(root, "src", "");

  for (const packageName of packages) {
    let current = srcFolder;
    const parts = packageName.split(".");
    let packagePath = "";

    for (const part of parts) {
      packagePath = packagePath ? `${packagePath}.${part}` : part;
      current = ensureFolder(current, part, packagePath);
    }
  }

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;

      if (isFile) {
        current.children.set(part, {
          type: "file",
          name: part,
          path: file.path,
        });
      } else {
        let packageName = "";

        if (parts[0] === "src" && index > 0) {
          packageName = parts.slice(1, index + 1).join(".");
        }

        current = ensureFolder(current, part, packageName);
      }
    });
  }

  return root;
}

function renderTreeNode(node, depth = 0) {
  const item = document.createElement("div");

  if (node.type === "folder") {
    const packageName = node.name === "src" ? "" : node.packageName || "";
    const isDragOver = dragOverPackage === packageName;

    item.className =
      "treeItem folder droppable" +
      (packageName === selectedPackage ? " selected" : "") +
      (selectedTreeType === "package" && packageName === selectedPackage && packageName ? " packageDeleteTarget" : "") +
      (isDragOver ? " dragOver" : "");
    item.style.paddingLeft = `${depth * 14 + 8}px`;
    item.textContent = depth === 0 ? "▾ project" : `▾ ${node.name}`;
    item.title = depth === 0 ? "ここにドロップすると src 直下へ移動します" : `${packageName || "src直下"} へ移動`;

    item.addEventListener("click", () => {
      selectPackage(packageName);
    });

    item.addEventListener("dragover", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      dragOverPackage = packageName;
      renderProjectTree();
    });

    item.addEventListener("dragleave", (event) => {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget && item.contains(relatedTarget)) return;
      dragOverPackage = null;
      renderProjectTree();
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const droppedFilePath = event.dataTransfer.getData("text/plain") || draggingFilePath;
      dragOverPackage = null;
      draggingFilePath = "";
      moveFileToPackage(droppedFilePath, packageName);
    });

    projectTreeEl.appendChild(item);

    const children = [...node.children.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });

    for (const child of children) {
      renderTreeNode(child, depth + 1);
    }
  } else {
    const isActive = files[activeFileIndex]?.path === node.path;
    const isMainFile = node.name === "Main.java";

    item.className = "treeItem file draggable" + (isActive ? " active" : "") + (isMainFile ? " mainFile" : "");
    item.style.paddingLeft = `${depth * 14 + 8}px`;
    item.textContent = `${isMainFile ? "🚀" : "☕"} ${node.name}`;
    item.title = `${node.path}：ドラッグしてパッケージへ移動できます`;
    item.draggable = true;

    item.addEventListener("click", () => {
      setActiveFileByPath(node.path);
    });

    item.addEventListener("dragstart", (event) => {
      saveCurrentFile();
      draggingFilePath = node.path;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.path);
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      draggingFilePath = "";
      dragOverPackage = null;
      item.classList.remove("dragging");
      renderProjectTree();
    });

    projectTreeEl.appendChild(item);
  }
}

function renderProjectTree() {
  projectTreeEl.innerHTML = "";
  const tree = buildProjectTree();
  renderTreeNode(tree, 0);
}

function showActiveFile() {
  if (!files[activeFileIndex]) {
    activeFileIndex = 0;
  }

  activeFileNameEl.textContent = files[activeFileIndex]?.path || "Javaファイルなし";

  if (editor && files[activeFileIndex]) {
    editor.setValue(files[activeFileIndex].content);
    editor.focus();
    setTimeout(() => editor.layout(), 0);
  }

  renderTabs();
  renderProjectTree();
  updateDeleteButtonState();
}

function getAllJavaClassNames() {
  const classNames = new Set(["Main", "String", "System", "Scanner", "ArrayList", "List", "HashMap", "Map"]);

  for (const file of files) {
    const matches = file.content.matchAll(/\b(?:class|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g);
    for (const match of matches) {
      classNames.add(match[1]);
    }
  }

  return [...classNames].sort((a, b) => a.localeCompare(b, "ja"));
}

function createCompletionItem(monaco, label, kind, insertText, documentation, range, insertTextRules = undefined) {
  return {
    label,
    kind,
    insertText,
    documentation,
    range,
    insertTextRules,
  };
}

function setupJavaAutocomplete(monaco) {
  monaco.languages.registerCompletionItemProvider("java", {
    triggerCharacters: [".", "@", " ", "("],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      const suggestions = [];

      if (/System\.out\.$/.test(textBeforeCursor)) {
        suggestions.push(
          createCompletionItem(monaco, "println", monaco.languages.CompletionItemKind.Method, "println(${1:\"Hello Java\"});", "標準出力に1行表示します。", range, snippet),
          createCompletionItem(monaco, "print", monaco.languages.CompletionItemKind.Method, "print(${1:\"Hello Java\"});", "標準出力に表示します。改行はしません。", range, snippet),
          createCompletionItem(monaco, "printf", monaco.languages.CompletionItemKind.Method, "printf(${1:\"%s\"}, ${2:value});", "書式付きで標準出力します。", range, snippet)
        );
      }

      if (/System\.$/.test(textBeforeCursor)) {
        suggestions.push(
          createCompletionItem(monaco, "out", monaco.languages.CompletionItemKind.Property, "out", "標準出力を扱います。", range),
          createCompletionItem(monaco, "err", monaco.languages.CompletionItemKind.Property, "err", "標準エラー出力を扱います。", range)
        );
      }

      const keywordItems = [
        "public", "private", "protected", "static", "final", "void", "class", "interface", "enum",
        "extends", "implements", "new", "return", "if", "else", "for", "while", "do", "switch",
        "case", "break", "continue", "try", "catch", "finally", "throw", "throws", "import", "package",
        "int", "long", "double", "float", "boolean", "char", "byte", "short", "String", "true", "false", "null"
      ];

      for (const keyword of keywordItems) {
        suggestions.push(createCompletionItem(monaco, keyword, monaco.languages.CompletionItemKind.Keyword, keyword, `Javaキーワード：${keyword}`, range));
      }

      const snippets = [
        {
          label: "main",
          insertText: "public static void main(String[] args) {\n    ${1:// 処理を書く}\n}",
          documentation: "mainメソッドを作成します。",
        },
        {
          label: "sout",
          insertText: "System.out.println(${1:\"Hello Java\"});",
          documentation: "System.out.println の短縮入力です。",
        },
        {
          label: "fori",
          insertText: "for (int ${1:i} = 0; ${1:i} < ${2:10}; ${1:i}++) {\n    ${3:// 処理を書く}\n}",
          documentation: "基本的なfor文を作成します。",
        },
        {
          label: "if",
          insertText: "if (${1:条件}) {\n    ${2:// 処理を書く}\n}",
          documentation: "if文を作成します。",
        },
        {
          label: "class",
          insertText: "public class ${1:ClassName} {\n\n}",
          documentation: "public class を作成します。",
        },
        {
          label: "constructor",
          insertText: "public ${1:ClassName}(${2}) {\n    ${3:// 初期化処理}\n}",
          documentation: "コンストラクタを作成します。",
        },
        {
          label: "import Scanner",
          insertText: "import java.util.Scanner;",
          documentation: "Scannerのimport文を追加します。",
        },
        {
          label: "import ArrayList",
          insertText: "import java.util.ArrayList;",
          documentation: "ArrayListのimport文を追加します。",
        },
        {
          label: "Scanner",
          insertText: "Scanner ${1:scanner} = new Scanner(System.in);",
          documentation: "Scannerのインスタンスを作成します。",
        },
        {
          label: "ArrayList",
          insertText: "ArrayList<${1:String}> ${2:list} = new ArrayList<>();",
          documentation: "ArrayListのインスタンスを作成します。",
        },
      ];

      for (const item of snippets) {
        suggestions.push(
          createCompletionItem(
            monaco,
            item.label,
            monaco.languages.CompletionItemKind.Snippet,
            item.insertText,
            item.documentation,
            range,
            snippet
          )
        );
      }

      for (const className of getAllJavaClassNames()) {
        suggestions.push(
          createCompletionItem(monaco, className, monaco.languages.CompletionItemKind.Class, className, `クラス候補：${className}`, range)
        );
      }

      for (const packageName of packages) {
        suggestions.push(
          createCompletionItem(monaco, packageName, monaco.languages.CompletionItemKind.Module, packageName, `パッケージ候補：${packageName}`, range)
        );
      }

      return { suggestions };
    },
  });
}

function initializeEditor() {
  if (!window.require) {
    outputEl.textContent = "Monaco Editorの読み込みに失敗しました。インターネット接続、またはCDNの読み込みを確認してください。";
    return;
  }

  window.require.config({
    paths: {
      vs: "https://cdn.jsdelivr.net/npm/monaco-editor/min/vs",
    },
  });

  window.require(["vs/editor/editor.main"], () => {
    monacoRef = window.monaco;
    setupJavaAutocomplete(monacoRef);

    editor = monacoRef.editor.create(codeEditorEl, {
      value: files[activeFileIndex].content,
      language: "java",
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 16,
      tabSize: 4,
      insertSpaces: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: "allDocuments",
      snippetSuggestions: "top",
      autoClosingBrackets: "always",
      autoClosingQuotes: "always",
      formatOnPaste: true,
      formatOnType: true,
    });

    editor.addCommand(monacoRef.KeyMod.CtrlCmd | monacoRef.KeyCode.Space, () => {
      editor.trigger("keyboard", "editor.action.triggerSuggest", {});
    });

    showActiveFile();
  });
}

clearButton.addEventListener("click", () => {
  outputEl.textContent = "ここに実行結果が表示されます。";
});

addPackageButton.addEventListener("click", () => {
  saveCurrentFile();

  const input = prompt("追加するパッケージ名を入力してください。\n例：com.example", selectedPackage || "");

  if (input === null) return;

  const packageName = normalizePackageName(input);

  if (!packageName) {
    alert("パッケージ名を入力してください。例：com.example");
    return;
  }

  if (!isValidPackageName(packageName)) {
    alert("パッケージ名が正しくありません。例：com.example");
    return;
  }

  if (packages.includes(packageName)) {
    alert(`${packageName} はすでに存在します。`);
    selectedPackage = packageName;
    selectedTreeType = "package";
    renderProjectTree();
    updateDeleteButtonState();
    return;
  }

  packages.push(packageName);
  sortPackages();
  selectedPackage = packageName;
  selectedTreeType = "package";
  renderProjectTree();
  updateDeleteButtonState();
});

addFileButton.addEventListener("click", () => {
  saveCurrentFile();

  const classInput = prompt("追加するクラス名を入力してください。\n例：Student または Student.java");

  if (classInput === null) return;

  const className = normalizeClassName(classInput);

  if (!className) {
    alert("クラス名を入力してください。");
    return;
  }

  if (!isValidClassName(className)) {
    alert("クラス名が正しくありません。例：Student");
    return;
  }

  const packageInput = prompt(
    "パッケージ名を入力してください。\n空欄なら src 直下に作成します。\n例：com.example",
    selectedPackage || ""
  );

  if (packageInput === null) return;

  const packageName = normalizePackageName(packageInput);

  if (!isValidPackageName(packageName)) {
    alert("パッケージ名が正しくありません。例：com.example");
    return;
  }

  const filePath = createFilePath(className, packageName);

  if (files.some((file) => file.path === filePath)) {
    alert(`${filePath} はすでに存在します。`);
    return;
  }

  if (packageName && !packages.includes(packageName)) {
    packages.push(packageName);
    sortPackages();
  }

  files.push({
    path: filePath,
    content: createClassTemplate(className, packageName),
  });

  sortFiles();
  activeFileIndex = files.findIndex((file) => file.path === filePath);
  selectedPackage = packageName;
  selectedTreeType = "file";
  showActiveFile();
});

deleteFileButton.addEventListener("click", () => {
  saveCurrentFile();

  if (selectedTreeType === "package" && selectedPackage) {
    deleteSelectedPackage();
    return;
  }

  const currentFile = files[activeFileIndex];

  if (!currentFile) {
    alert("削除するファイルがありません。");
    return;
  }

  if (files.length <= 1) {
    alert("Javaファイルが0件になるため削除できません。");
    return;
  }

  if (!confirm(`${currentFile.path} を削除しますか？`)) {
    return;
  }

  files.splice(activeFileIndex, 1);
  activeFileIndex = Math.max(0, activeFileIndex - 1);
  selectedPackage = getPackageFromPath(files[activeFileIndex]?.path || "");
  selectedTreeType = "file";
  showActiveFile();
});

runButton.addEventListener("click", async () => {
  saveCurrentFile();

  if (!API_BASE || API_BASE.includes("YOUR-WORKER-URL")) {
    outputEl.textContent = "設定エラー：frontend/app.js の API_BASE を Cloudflare Worker のURLに変更してください。";
    return;
  }

  const mainClass = normalizePackageName(mainClassEl.value || "Main");

  if (!isValidPackageName(mainClass)) {
    outputEl.textContent = "実行クラス名が正しくありません。例：Main または com.example.Main";
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
        files,
        main_class: mainClass,
        stdin: "",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      outputEl.textContent = data.error || "実行に失敗しました。";
      return;
    }

    let message = "";

    if (data.status && data.status !== "Accepted") {
      message += `ステータス：${data.status}\n\n`;
    }

    if (data.stdout) {
      message += data.stdout;
    }

    if (data.stderr) {
      message += data.stderr;
    }

    if (data.compile_output) {
      message += data.compile_output;
    }

    if (!data.stdout && !data.stderr && !data.compile_output) {
      message += "出力はありません。";
    }

    if (data.time || data.memory) {
      message += "\n\n---\n";
      if (data.time) {
        message += `実行時間：${data.time}秒\n`;
      }
      if (data.memory) {
        message += `メモリ：${data.memory}KB\n`;
      }
    }

    outputEl.textContent = message;
  } catch (error) {
    outputEl.textContent = "通信エラー：WorkerのURL、公開状態、CORS設定を確認してください。\n\n" + error.message;
  } finally {
    runButton.disabled = false;
  }
});

initializeEditor();
