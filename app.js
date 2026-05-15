// ここを Cloudflare Worker のURLに置き換えてください。
// 例: const API_BASE = "https://java-runner-proxy.xxxxx.workers.dev";
const API_BASE = "https://java-runner-proxy.ryuryu-dm0825.workers.dev";

const codeEl = document.getElementById("code");
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

function saveCurrentFile() {
  files[activeFileIndex].content = codeEl.value;
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

function setActiveFileByPath(path) {
  saveCurrentFile();

  const index = files.findIndex((file) => file.path === path);
  if (index === -1) return;

  activeFileIndex = index;
  selectedPackage = getPackageFromPath(files[index].path);
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
      showActiveFile();
    });

    fileTabsEl.appendChild(tabButton);
  });

  deleteFileButton.disabled = files[activeFileIndex].path === "src/Main.java";
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
    item.className = "treeItem folder" + (node.packageName === selectedPackage ? " selected" : "");
    item.style.paddingLeft = `${depth * 14 + 8}px`;
    item.textContent = depth === 0 ? "▾ project" : `▾ ${node.name}`;

    item.addEventListener("click", () => {
      selectedPackage = node.name === "src" ? "" : node.packageName || "";
      renderProjectTree();
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
    item.className = "treeItem file" + (isActive ? " active" : "");
    item.style.paddingLeft = `${depth * 14 + 8}px`;
    item.textContent = `☕ ${node.name}`;
    item.title = node.path;

    item.addEventListener("click", () => {
      setActiveFileByPath(node.path);
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
  activeFileNameEl.textContent = files[activeFileIndex].path;
  codeEl.value = files[activeFileIndex].content;
  renderTabs();
  renderProjectTree();
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
    renderProjectTree();
    return;
  }

  packages.push(packageName);
  sortPackages();
  selectedPackage = packageName;
  renderProjectTree();
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
  showActiveFile();
});

deleteFileButton.addEventListener("click", () => {
  saveCurrentFile();

  const currentFile = files[activeFileIndex];

  if (currentFile.path === "src/Main.java") {
    alert("src/Main.java は削除できません。");
    return;
  }

  if (!confirm(`${currentFile.path} を削除しますか？`)) {
    return;
  }

  files.splice(activeFileIndex, 1);
  activeFileIndex = 0;
  selectedPackage = "";
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

showActiveFile();
