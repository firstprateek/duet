/** Copy buttons: data-copy holds the text, or a function supplies it. */
export function copyButton(button, text = () => button.dataset.copy ?? "") {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
      button.textContent = "Copied";
      button.dataset.done = "";
    } catch {
      button.textContent = "Select it and copy";
    }
    setTimeout(() => {
      button.textContent = label;
      delete button.dataset.done;
    }, 2200);
  });
}
