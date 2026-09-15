/**
 * File scorer.
 *
 * Lives in its own tab rather than the popup: opening a file dialog from an
 * extension popup closes the popup on several platforms, and a long report
 * wants the room anyway.
 */
(function () {
  "use strict";

  const view = document.getElementById("view");
  const input = document.getElementById("file");

  function showStatus(message, isError) {
    const status = document.createElement("p");
    status.className = isError ? "status error" : "status";
    status.textContent = message;
    view.replaceChildren(status);

    if (isError) {
      view.appendChild(dropzone());
    }
  }

  function dropzone() {
    const zone = document.createElement("div");
    zone.className = "dropzone";

    const title = document.createElement("h2");
    title.textContent = "Score a PDF or text file";

    const blurb = document.createElement("p");
    blurb.textContent =
      "Drop it here, or pick one. The file is parsed in this tab and never leaves your machine.";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "pick";
    button.textContent = "Choose file";
    button.addEventListener("click", () => input.click());

    zone.append(title, blurb, button);
    wireDrop(zone);

    return zone;
  }

  function subjectBar(name) {
    const bar = document.createElement("div");
    bar.className = "subject";

    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name;

    const another = document.createElement("button");
    another.type = "button";
    another.textContent = "Choose another";
    another.addEventListener("click", () => input.click());

    bar.append(label, another);
    return bar;
  }

  async function score(file) {
    showStatus(`Reading ${file.name}…`);

    try {
      const text = await window.SlopLens.readFile(file);
      const analysis = window.SlopGuard.analyzeText(text);

      const report = window.SlopLens.report.build(
        { analysis },
        { subject: file.name, actions: null }
      );

      view.replaceChildren(subjectBar(file.name), report);
      document.title = `Slop Lens: ${file.name}`;
    } catch (error) {
      showStatus(error.message || String(error), true);
    }
  }

  function wireDrop(target) {
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      target.classList.add("over");
    });

    target.addEventListener("dragleave", () => target.classList.remove("over"));

    target.addEventListener("drop", (event) => {
      event.preventDefault();
      target.classList.remove("over");

      const file = event.dataTransfer.files[0];
      if (file) {
        score(file);
      }
    });
  }

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (file) {
      score(file);
    }
    // Let the same file be picked twice in a row.
    input.value = "";
  });

  document.getElementById("pick").addEventListener("click", () => input.click());
  wireDrop(document.getElementById("drop"));

  // Dropping anywhere on the page should work, not just on the zone.
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      score(file);
    }
  });
})();
