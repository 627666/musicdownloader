const form = document.querySelector("#membership-form");
const result = document.querySelector("#registration-result");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.textContent = "正在注册...";

  const body = Object.fromEntries(new FormData(form).entries());

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "注册失败，请稍后再试。");

    result.innerHTML = `
      <strong>会员密钥：</strong>${escapeHtml(data.licenseKey)}<br>
      <strong>验证地址：</strong>${escapeHtml(data.validationUrl)}
    `;
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}
