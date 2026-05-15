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
const moveFileButton = document.getElementById("moveFileButton");
const fileTabsEl = document.getElementById("fileTabs");
const projectTreeEl = document.getElementById("projectTree");
const dropTargetPanelEl = document.getElementById("dropTargetPanel");
const projectSidebarEl = document.querySelector(".projectSidebar");
const activeFileNameEl = document.getElementById("activeFileName");
const mainClassEl = document.getElementById("mainClass");
const suggestButton = document.getElementById("suggestButton");
const indentButton = document.getElementById("indentButton");
const outdentButton = document.getElementById("outdentButton");

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
let pointerDragState = null;
let dragGhostEl = null;
let suppressNextFileClick = false;


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


function getKnownDropTargets() {
  const targetMap = new Map();

  targetMap.set("", {
    packageName: "",
    label: "src直下",
    path: "src/",
  });

  for (const packageName of packages) {
    targetMap.set(packageName, {
      packageName,
      label: packageName,
      path: `src/${packageToPath(packageName)}`,
    });
  }

  for (const file of files) {
    const packageName = getPackageFromPath(file.path);
    if (packageName && !targetMap.has(packageName)) {
      targetMap.set(packageName, {
        packageName,
        label: packageName,
        path: `src/${packageToPath(packageName)}`,
      });
    }
  }

  return [...targetMap.values()].sort((a, b) => {
    if (!a.packageName) return -1;
    if (!b.packageName) return 1;
    return a.packageName.localeCompare(b.packageName, "ja");
  });
}


function createDragGhost(filePath) {
  removeDragGhost();

  dragGhostEl = document.createElement("div");
  dragGhostEl.className = "dragGhost";
  dragGhostEl.textContent = `移動中：${filePath}`;
  document.body.appendChild(dragGhostEl);
}

function updateDragGhost(event) {
  if (!dragGhostEl) return;
  dragGhostEl.style.left = `${event.clientX + 14}px`;
  dragGhostEl.style.top = `${event.clientY + 14}px`;
}

function removeDragGhost() {
  if (dragGhostEl) {
    dragGhostEl.remove();
    dragGhostEl = null;
  }
}

function startCustomFileDrag(filePath, item, event) {
  saveCurrentFile();
  draggingFilePath = filePath;
  item.classList.add("dragging");
  projectTreeEl.classList.add("dragMode");
  dropTargetPanelEl?.classList.add("dragMode");
  renderDropTargetPanel();
  createDragGhost(filePath);
  updateDragGhost(event);
  applyDragOverStyle(getDropPackageFromElement(document.elementFromPoint(event.clientX, event.clientY)));
}

function finishCustomFileDrag(event) {
  if (!pointerDragState) return;

  const wasDragging = pointerDragState.started;
  const filePath = pointerDragState.filePath;
  const item = pointerDragState.item;

  try {
    if (item && pointerDragState.pointerId !== undefined) {
      item.releasePointerCapture?.(pointerDragState.pointerId);
    }
  } catch (error) {
    // すでに解放済みの場合は何もしません。
  }

  pointerDragState = null;

  if (!wasDragging) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  suppressNextFileClick = true;

  const element = document.elementFromPoint(event.clientX, event.clientY);
  const targetPackage = getDropPackageFromElement(element);

  draggingFilePath = "";
  clearDragOverStyle();
  removeDragGhost();
  item?.classList.remove("dragging", "dragArmed");

  moveFileToPackage(filePath, targetPackage);

  window.setTimeout(() => {
    suppressNextFileClick = false;
  }, 0);
}

function cancelCustomFileDrag() {
  if (!pointerDragState) return;

  const item = pointerDragState.item;
  pointerDragState = null;
  draggingFilePath = "";
  clearDragOverStyle();
  removeDragGhost();
  item?.classList.remove("dragging", "dragArmed");
}

function setupEasyDragStart(item, filePath) {
  item.addEventListener("pointerdown", (event) => {
    // 左クリック・ペン・タッチだけ対象にします。
    if (event.button !== undefined && event.button !== 0) return;

    pointerDragState = {
      filePath,
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    };

    item.classList.add("dragArmed");
    item.setPointerCapture?.(event.pointerId);
  });

  item.addEventListener("pointermove", (event) => {
    if (!pointerDragState || pointerDragState.filePath !== filePath) return;

    const dx = event.clientX - pointerDragState.startX;
    const dy = event.clientY - pointerDragState.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // かなり小さい移動でもドラッグ開始にします。
    if (!pointerDragState.started && distance >= 2) {
      pointerDragState.started = true;
      startCustomFileDrag(filePath, item, event);
    }

    if (!pointerDragState.started) return;

    event.preventDefault();
    event.stopPropagation();
    updateDragGhost(event);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    applyDragOverStyle(getDropPackageFromElement(element));
  });

  item.addEventListener("pointerup", finishCustomFileDrag);
  item.addEventListener("pointercancel", cancelCustomFileDrag);
  item.addEventListener("lostpointercapture", () => {
    if (pointerDragState?.started) return;
    item.classList.remove("dragArmed");
    pointerDragState = null;
  });
}

function renderDropTargetPanel() {
  if (!dropTargetPanelEl) return;

  dropTargetPanelEl.innerHTML = "";

  const title = document.createElement("div");
  title.className = "dropTargetTitle";
  title.textContent = draggingFilePath
    ? "移動先：大きい枠で離してください"
    : "移動先：ファイル選択後にクリックでも移動できます";
  dropTargetPanelEl.appendChild(title);

  for (const target of getKnownDropTargets()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dropTarget" + (dragOverPackage === target.packageName ? " dragOver" : "");
    button.dataset.packageName = target.packageName;
    button.innerHTML = `<span>${target.label}</span><small>${target.path}</small>`;

    button.addEventListener("click", () => {
      const currentFile = files[activeFileIndex];
      if (!currentFile) return;
      moveFileToPackage(currentFile.path, target.packageName);
    });

    button.addEventListener("dragenter", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      applyDragOverStyle(target.packageName);
    });

    button.addEventListener("dragover", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      applyDragOverStyle(target.packageName);
    });

    button.addEventListener("drop", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      const droppedFilePath = event.dataTransfer.getData("text/plain") || draggingFilePath;
      draggingFilePath = "";
      clearDragOverStyle();
      moveFileToPackage(droppedFilePath, target.packageName);
    });

    dropTargetPanelEl.appendChild(button);
  }
}

function getDropPackageFromElement(target) {
  const dropTarget = target?.closest?.(".dropTarget");

  if (dropTarget && dropTargetPanelEl?.contains(dropTarget)) {
    return dropTarget.dataset.packageName || "";
  }

  const treeItem = target?.closest?.(".treeItem");

  if (!treeItem || !projectTreeEl.contains(treeItem)) {
    return "";
  }

  if (treeItem.dataset.type === "folder") {
    return treeItem.dataset.packageName || "";
  }

  if (treeItem.dataset.type === "file") {
    return getPackageFromPath(treeItem.dataset.filePath || "");
  }

  return "";
}

function applyDragOverStyle(packageName) {
  const normalizedPackage = normalizePackageName(packageName || "");
  dragOverPackage = normalizedPackage;

  projectTreeEl.classList.toggle("dragMode", Boolean(draggingFilePath));
  projectTreeEl.classList.toggle("dropRoot", Boolean(draggingFilePath) && !normalizedPackage);

  projectTreeEl.querySelectorAll(".treeItem.dragOver").forEach((element) => {
    element.classList.remove("dragOver");
  });

  projectTreeEl.querySelectorAll(".treeItem.folder").forEach((element) => {
    if ((element.dataset.packageName || "") === normalizedPackage) {
      element.classList.add("dragOver");
    }
  });

  dropTargetPanelEl?.classList.toggle("dragMode", Boolean(draggingFilePath));
  dropTargetPanelEl?.querySelectorAll(".dropTarget").forEach((element) => {
    element.classList.toggle("dragOver", (element.dataset.packageName || "") === normalizedPackage);
  });
}

function clearDragOverStyle() {
  dragOverPackage = null;
  projectTreeEl.classList.remove("dragMode", "dropRoot");
  dropTargetPanelEl?.classList.remove("dragMode");
  projectTreeEl.querySelectorAll(".treeItem.dragOver").forEach((element) => {
    element.classList.remove("dragOver");
  });
  dropTargetPanelEl?.querySelectorAll(".dropTarget.dragOver").forEach((element) => {
    element.classList.remove("dragOver");
  });
}

function moveActiveFileWithPrompt() {
  saveCurrentFile();

  const currentFile = files[activeFileIndex];

  if (!currentFile) {
    alert("移動するファイルがありません。");
    return;
  }

  const currentPackage = getPackageFromPath(currentFile.path);
  const packageInput = prompt(
    "移動先のパッケージ名を入力してください。\n空欄なら src 直下へ移動します。\n例：com.example",
    currentPackage
  );

  if (packageInput === null) return;

  moveFileToPackage(currentFile.path, packageInput);
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
    item.dataset.type = "folder";
    item.dataset.packageName = packageName;
    item.style.paddingLeft = `${depth * 14 + 8}px`;
    item.textContent = depth === 0 ? "▾ project" : `▾ ${node.name}`;
    item.title = depth === 0 ? "ここにドロップすると src 直下へ移動します" : `${packageName || "src直下"} へ移動`;

    item.addEventListener("click", () => {
      selectPackage(packageName);
    });

    item.addEventListener("dragover", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      applyDragOverStyle(packageName);
    });

    item.addEventListener("drop", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      const droppedFilePath = event.dataTransfer.getData("text/plain") || draggingFilePath;
      draggingFilePath = "";
      clearDragOverStyle();
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

    item.className = "treeItem file draggable easyDrag" + (isActive ? " active" : "") + (isMainFile ? " mainFile" : "");
    item.dataset.type = "file";
    item.dataset.filePath = node.path;
    item.style.paddingLeft = `${depth * 14 + 8}px`;
    item.innerHTML = `<span class="treeGrabHandle" aria-hidden="true">⠿ 移動</span><span class="treeFileName">${isMainFile ? "🚀" : "☕"} ${node.name}</span>`;
    item.title = `${node.path}：行全体をつかんで動かせます。少し動かすだけでドラッグ開始します。`;
    item.draggable = true;

    item.addEventListener("click", () => {
      if (suppressNextFileClick) return;
      setActiveFileByPath(node.path);
    });

    setupEasyDragStart(item, node.path);

    item.addEventListener("dragstart", (event) => {
      saveCurrentFile();
      draggingFilePath = node.path;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.path);
      item.classList.add("dragging");
      projectTreeEl.classList.add("dragMode");
      dropTargetPanelEl?.classList.add("dragMode");
      renderDropTargetPanel();
    });

    item.addEventListener("dragover", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      applyDragOverStyle(getPackageFromPath(node.path));
    });

    item.addEventListener("drop", (event) => {
      if (!draggingFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      const droppedFilePath = event.dataTransfer.getData("text/plain") || draggingFilePath;
      const targetPackage = getPackageFromPath(node.path);
      draggingFilePath = "";
      clearDragOverStyle();
      moveFileToPackage(droppedFilePath, targetPackage);
    });

    item.addEventListener("dragend", () => {
      draggingFilePath = "";
      clearDragOverStyle();
      removeDragGhost();
      item.classList.remove("dragging", "dragArmed");
    });

    projectTreeEl.appendChild(item);
  }
}

function renderProjectTree() {
  renderDropTargetPanel();
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

function isMobileLayout() {
  return window.matchMedia("(max-width: 700px)").matches;
}

function getResponsiveEditorOptions() {
  const mobile = isMobileLayout();

  return {
    automaticLayout: true,
    fontSize: mobile ? 14 : 16,
    lineHeight: mobile ? 22 : 24,
    tabSize: 4,
    insertSpaces: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    // スマホでは折り返さず、横スクロールでインデントを見やすくします。
    wordWrap: mobile ? "off" : "on",
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: "allDocuments",
    snippetSuggestions: "top",
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    formatOnPaste: true,
    formatOnType: true,
    lineNumbers: "on",
    lineNumbersMinChars: mobile ? 3 : 5,
    glyphMargin: !mobile,
    folding: !mobile,
    overviewRulerLanes: mobile ? 0 : 2,
    renderLineHighlight: mobile ? "none" : "line",
    padding: { top: mobile ? 10 : 14, bottom: mobile ? 16 : 20 },
    scrollbar: {
      vertical: "visible",
      horizontal: "visible",
      horizontalScrollbarSize: mobile ? 12 : 10,
      verticalScrollbarSize: mobile ? 12 : 10,
      alwaysConsumeMouseWheel: false,
    },
  };
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
      ...getResponsiveEditorOptions(),
    });

    editor.addCommand(monacoRef.KeyMod.CtrlCmd | monacoRef.KeyCode.Space, () => {
      editor.trigger("keyboard", "editor.action.triggerSuggest", {});
    });

    window.addEventListener("resize", () => {
      if (!editor) return;
      editor.updateOptions(getResponsiveEditorOptions());
      editor.layout();
    });

    showActiveFile();
  });
}

projectTreeEl.addEventListener("dragover", (event) => {
  if (!draggingFilePath) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  applyDragOverStyle(getDropPackageFromElement(event.target));
});

projectTreeEl.addEventListener("drop", (event) => {
  if (!draggingFilePath) return;
  event.preventDefault();
  const droppedFilePath = event.dataTransfer.getData("text/plain") || draggingFilePath;
  const targetPackage = getDropPackageFromElement(event.target);
  draggingFilePath = "";
  clearDragOverStyle();
  moveFileToPackage(droppedFilePath, targetPackage);
});

projectTreeEl.addEventListener("mouseleave", () => {
  if (!draggingFilePath) return;
  applyDragOverStyle("");
});

if (projectSidebarEl) {
  projectSidebarEl.addEventListener("dragover", (event) => {
    if (!draggingFilePath) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    applyDragOverStyle(getDropPackageFromElement(event.target));
  });

  projectSidebarEl.addEventListener("drop", (event) => {
    if (!draggingFilePath) return;
    event.preventDefault();
    const droppedFilePath = event.dataTransfer.getData("text/plain") || draggingFilePath;
    const targetPackage = getDropPackageFromElement(event.target);
    draggingFilePath = "";
    clearDragOverStyle();
    moveFileToPackage(droppedFilePath, targetPackage);
  });
}

clearButton.addEventListener("click", () => {
  outputEl.textContent = "ここに実行結果が表示されます。";
});

if (suggestButton) {
  suggestButton.addEventListener("click", () => {
    if (!editor) return;
    editor.focus();
    editor.trigger("mobile", "editor.action.triggerSuggest", {});
  });
}

if (indentButton) {
  indentButton.addEventListener("click", () => {
    if (!editor) return;
    editor.focus();
    editor.trigger("mobile", "editor.action.indentLines", {});
  });
}

if (outdentButton) {
  outdentButton.addEventListener("click", () => {
    if (!editor) return;
    editor.focus();
    editor.trigger("mobile", "editor.action.outdentLines", {});
  });
}

if (moveFileButton) {
  moveFileButton.addEventListener("click", moveActiveFileWithPrompt);
}

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
