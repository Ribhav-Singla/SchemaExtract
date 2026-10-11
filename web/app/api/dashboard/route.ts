import os from "node:os";
import { statfs } from "node:fs/promises";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function toRoundedPercentage(used: number, total: number) {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

function cpuSnapshot() {
  return os.cpus().reduce(
    (total, cpu) => {
      const times = cpu.times;
      return {
        idle: total.idle + times.idle,
        total:
          total.total +
          times.user +
          times.nice +
          times.sys +
          times.irq +
          times.idle,
      };
    },
    { idle: 0, total: 0 },
  );
}

async function sampleCpuUsage() {
  const first = cpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const second = cpuSnapshot();
  const totalDelta = second.total - first.total;
  const idleDelta = second.idle - first.idle;
  return totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
}

export async function GET() {
  try {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const cpuCount = os.cpus().length;
    const cpuUsage = await sampleCpuUsage();
    const disk = await statfs(process.cwd());
    const totalDisk = Number(disk.blocks) * Number(disk.bsize);
    const freeDisk = Number(disk.bavail) * Number(disk.bsize);
    const usedDisk = Math.max(0, totalDisk - freeDisk);

    return NextResponse.json({
      cpu: {
        usage: Math.round(cpuUsage * 10) / 10,
        cores: cpuCount,
        model: os.cpus()[0]?.model ?? "Unknown",
      },
      memory: {
        usedBytes: usedMemory,
        totalBytes: totalMemory,
        usage: toRoundedPercentage(usedMemory, totalMemory),
      },
      disk: {
        usedBytes: usedDisk,
        totalBytes: totalDisk,
        usage: toRoundedPercentage(usedDisk, totalDisk),
        path: process.cwd(),
      },
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("System metrics collection failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "System metrics unavailable" },
      { status: 500 },
    );
  }
}
