/* "Push from VS Code" guide, filled in with this Sitebox's address. */
import { $, codeBlock } from "./ui.js";

export function openPushHelp() {
  const origin = location.origin;
  $("#push-body").innerHTML = `
    <p>Sitebox works like <code>git push</code>: run one command in your project and the site appears here, with every push kept as a version you can roll back to.</p>

    <h3>1. Install the CLI once</h3>
    <p>In the Sitebox project folder on your computer:</p>
    ${codeBlock("npm link")}

    <h3>2. Connect it to this Sitebox</h3>
    ${codeBlock(`sitebox login ${origin} <your-token>`)}
    <p class="muted">Use the same token you enter in this app.</p>

    <h3>3. Push from any project</h3>
    <p>Open the project in VS Code, open the terminal (<kbd>Ctrl</kbd>+<kbd>\`</kbd>) and run:</p>
    ${codeBlock("sitebox init my-site")}
    ${codeBlock('sitebox push -m "first version"')}
    <p>To push automatically on every save:</p>
    ${codeBlock("sitebox watch")}

    <h3>One-key push in VS Code</h3>
    <ol>
      <li>Copy <code>.vscode/tasks.json</code> from the Sitebox folder into your project.</li>
      <li>Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> and choose <b>Sitebox: push</b>.</li>
    </ol>
    <p class="muted">You can also push a single file (<code>sitebox push page.html</code>) or a zip (<code>sitebox push site.zip</code>). This app picks up pushes within a few seconds.</p>`;
  $("#dlg-push").showModal();
}
