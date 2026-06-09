const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/register" && request.method === "POST") {
      return registerMember(request, env, url);
    }

    if ((url.pathname === "/api/validate" || url.pathname === "/membership/verify") && request.method === "POST") {
      return validateMembership(request, env);
    }

    return json({ message: "Not found" }, 404);
  }
};

async function registerMember(request, env, url) {
  const input = await request.json();
  const email = String(input.email || "").trim().toLowerCase();
  const name = String(input.name || "").trim();
  const plan = input.plan === "yearly" ? "yearly" : "monthly";

  if (!email || !email.includes("@")) {
    return json({ message: "请填写有效邮箱。" }, 400);
  }

  const now = Date.now();
  const expiresAt = now + (plan === "yearly" ? 366 : 31) * 24 * 60 * 60 * 1000;
  const licenseKey = `MD-${crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
  const member = {
    active: true,
    appName: "musicdownloader",
    createdAt: new Date(now).toISOString(),
    email,
    expiresAt,
    machines: [],
    memberId: crypto.randomUUID(),
    name,
    planName: plan === "yearly" ? "年度会员" : "月度会员"
  };

  await env.MEMBERSHIPS.put(licenseKey, JSON.stringify(member));

  return json({
    licenseKey,
    planName: member.planName,
    expiresAt: new Date(expiresAt).toISOString(),
    validationUrl: `${url.origin}/api/validate`
  });
}

async function validateMembership(request, env) {
  const input = await request.json();
  const licenseKey = String(input.licenseKey || "").trim();
  const machineId = String(input.machineId || "").trim();
  const appName = String(input.appName || "").trim();

  if (!licenseKey) {
    return json({ active: false, message: "Missing membership key." }, 400);
  }

  const stored = await env.MEMBERSHIPS.get(licenseKey);
  if (!stored) {
    return json({ active: false, message: "Membership key was not found." });
  }

  const member = JSON.parse(stored);
  if (member.appName !== appName) {
    return json({ active: false, message: "Membership key is for another app." });
  }

  if (!member.active || Number(member.expiresAt) <= Date.now()) {
    return json({
      active: false,
      planName: member.planName,
      expiresAt: new Date(Number(member.expiresAt)).toISOString(),
      memberId: member.memberId,
      message: "Membership has expired or is inactive."
    });
  }

  const machines = Array.isArray(member.machines) ? member.machines : [];
  if (machineId && !machines.includes(machineId)) {
    if (machines.length >= 3) {
      return json({ active: false, message: "This membership has reached the device limit." });
    }
    machines.push(machineId);
    member.machines = machines;
    await env.MEMBERSHIPS.put(licenseKey, JSON.stringify(member));
  }

  return json({
    active: true,
    planName: member.planName,
    expiresAt: new Date(Number(member.expiresAt)).toISOString(),
    memberId: member.memberId,
    message: "Membership verified."
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
