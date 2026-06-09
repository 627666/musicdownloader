import { app } from "electron";
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppSettings, MembershipStatus } from "../shared/types.js";

const membershipFile = () => path.join(app.getPath("userData"), "membership.json");
const downloadsPerVerification = 5;
let membershipUpdateQueue = Promise.resolve();

interface MembershipResponse {
  active?: boolean;
  planName?: string;
  expiresAt?: string | number;
  memberId?: string;
  message?: string;
}

export async function getMembershipStatus(settings: AppSettings): Promise<MembershipStatus> {
  const saved = await readMembershipStatus();
  if (!settings.membershipKey.trim()) {
    return { state: "trial", message: "当前为试用模式，可正常体验下载；VIP 功能后续开放。" };
  }
  if (!saved) {
    return { state: "trial", message: "已填写 VIP 激活码，点击激活后可升级为 VIP。", validationUrl: settings.membershipValidationUrl };
  }
  if (saved.keyHash !== keyHash(settings.membershipKey)) {
    return { state: "trial", message: "VIP 激活码已变更，请重新激活。", validationUrl: settings.membershipValidationUrl };
  }
  if (saved.expiresAt && saved.expiresAt <= Date.now()) {
    return { ...saved, state: "expired", message: saved.message ?? "VIP 已过期，当前按试用模式使用。" };
  }
  return saved;
}

export async function verifyMembership(settings: AppSettings): Promise<MembershipStatus> {
  const membershipKey = settings.membershipKey.trim();
  const validationUrl = settings.membershipValidationUrl.trim();
  if (!membershipKey) {
    return clearMembership();
  }

  if (!validationUrl) {
    return verifyDevelopmentMembership(membershipKey);
  }

  try {
    const response = await fetch(validationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: membershipKey,
        machineId: machineId(),
        appName: "musicdownloader"
      })
    });
    if (!response.ok) throw new Error(`Membership server returned ${response.status}.`);
    const data = (await response.json()) as MembershipResponse;
    const expiresAt = parseExpiresAt(data.expiresAt);
    const active = Boolean(data.active) && (!expiresAt || expiresAt > Date.now());
    return writeMembershipStatus({
      state: active ? "active" : expiresAt && expiresAt <= Date.now() ? "expired" : "invalid",
      checkedAt: Date.now(),
      planName: data.planName,
      expiresAt,
      memberId: data.memberId,
      message: data.message ?? (active ? "VIP 已激活。" : "VIP 激活码暂不可用。"),
      validationUrl,
      keyHash: keyHash(membershipKey),
      downloadsSinceLastVerification: 0
    });
  } catch (error) {
    return writeMembershipStatus({
      state: "invalid",
      checkedAt: Date.now(),
      message: error instanceof Error ? error.message : String(error),
      validationUrl,
      keyHash: keyHash(membershipKey),
      downloadsSinceLastVerification: 0
    });
  }
}

export async function clearMembership(): Promise<MembershipStatus> {
  await rm(membershipFile(), { force: true });
  return { state: "trial", message: "已清除 VIP 激活信息，当前为试用模式。" };
}

export async function requireActiveMembership(settings: AppSettings): Promise<void> {
  const status = await getMembershipStatus(settings);
  if (status.state === "invalid") {
    throw new Error(status.message ?? "VIP 状态异常，请清除激活信息后重试。");
  }
}

export async function recordCompletedDownloadAndMaybeVerify(settings: AppSettings): Promise<MembershipStatus> {
  return queueMembershipUpdate(async () => {
    const current = await getMembershipStatus(settings);
    if (!settings.membershipKey.trim() || current.state === "invalid") return current;

    const downloadsSinceLastVerification = (current.downloadsSinceLastVerification ?? 0) + 1;
    if (downloadsSinceLastVerification < downloadsPerVerification) {
      return writeMembershipStatus({
        ...current,
        downloadsSinceLastVerification,
        keyHash: keyHash(settings.membershipKey)
      });
    }

    const verified = await verifyMembership(settings);
    return writeMembershipStatus({
      ...verified,
      downloadsSinceLastVerification: 0
    });
  });
}

async function verifyDevelopmentMembership(membershipKey: string): Promise<MembershipStatus> {
  if (!membershipKey.startsWith("MD-DEV-")) {
    return writeMembershipStatus({
      state: "invalid",
      checkedAt: Date.now(),
      message: "VIP 激活码格式不正确。",
      keyHash: keyHash(membershipKey),
      downloadsSinceLastVerification: 0
    });
  }

  return writeMembershipStatus({
    state: "active",
    checkedAt: Date.now(),
    planName: "VIP",
    memberId: membershipKey.slice(0, 12),
    message: "VIP 已激活。",
    keyHash: keyHash(membershipKey),
    downloadsSinceLastVerification: 0
  });
}

async function readMembershipStatus(): Promise<MembershipStatus | null> {
  try {
    return JSON.parse(await readFile(membershipFile(), "utf8")) as MembershipStatus;
  } catch {
    return null;
  }
}

async function writeMembershipStatus(status: MembershipStatus): Promise<MembershipStatus> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(membershipFile(), JSON.stringify(status, null, 2), "utf8");
  return status;
}

function parseExpiresAt(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function machineId(): string {
  return crypto.createHash("sha256").update(`${os.hostname()}|${app.getPath("userData")}`).digest("hex");
}

function keyHash(membershipKey: string): string {
  return crypto.createHash("sha256").update(membershipKey.trim()).digest("hex");
}

function queueMembershipUpdate<T>(update: () => Promise<T>): Promise<T> {
  const next = membershipUpdateQueue.then(update, update);
  membershipUpdateQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}
