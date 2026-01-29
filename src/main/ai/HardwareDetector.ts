/**
 * Hardware Detector
 *
 * Detects system hardware capabilities including:
 * - CPU cores and model
 * - Available RAM
 * - GPU and VRAM (with CUDA/Metal/Vulkan support detection)
 * - Calculates hardware tier for model recommendations
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.2
 */

import type { HardwareInfo, HardwareTier, CPUInfo, MemoryInfo, GPUInfo } from './types'

// TODO: Import systeminformation when implementing
// import si from 'systeminformation'

/**
 * Hardware tier thresholds
 */
const TIER_THRESHOLDS = {
  // RAM thresholds in GB
  ram: {
    low: 8,
    medium: 16,
    high: 32,
    ultra: 64
  },
  // VRAM thresholds in GB
  vram: {
    low: 0,
    medium: 4,
    high: 8,
    ultra: 16
  }
}

export class HardwareDetector {
  private static cachedInfo: HardwareInfo | null = null
  private static cacheTimestamp: number = 0
  private static readonly CACHE_TTL = 60000 // 1 minute

  /**
   * Detect hardware capabilities
   * TODO: Implement with systeminformation
   */
  static async detect(): Promise<HardwareInfo> {
    // Return cached if valid
    const now = Date.now()
    if (this.cachedInfo && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedInfo
    }

    // TODO: Implement actual hardware detection using systeminformation
    // const cpu = await si.cpu()
    // const mem = await si.mem()
    // const graphics = await si.graphics()

    const cpuInfo: CPUInfo = {
      brand: 'Unknown',
      cores: 4,
      physicalCores: 4,
      speed: 2400
    }

    const memoryInfo: MemoryInfo = {
      totalBytes: 16 * 1024 * 1024 * 1024, // 16GB placeholder
      availableBytes: 8 * 1024 * 1024 * 1024
    }

    const gpuInfo: GPUInfo = {
      name: 'Unknown',
      vendor: 'Unknown',
      vramBytes: null,
      hasCuda: false,
      hasMetal: process.platform === 'darwin',
      hasVulkan: false,
      driverVersion: null
    }

    const tier = this.calculateTier(memoryInfo, gpuInfo)

    this.cachedInfo = {
      cpu: cpuInfo,
      memory: memoryInfo,
      gpu: gpuInfo,
      platform: process.platform,
      tier
    }
    this.cacheTimestamp = now

    return this.cachedInfo
  }

  /**
   * Calculate hardware tier based on RAM and VRAM
   */
  static calculateTier(memory: MemoryInfo, gpu: GPUInfo): HardwareTier {
    const ramGB = memory.totalBytes / (1024 * 1024 * 1024)
    const vramGB = gpu.vramBytes ? gpu.vramBytes / (1024 * 1024 * 1024) : 0

    // Determine tier based on the limiting factor
    if (ramGB >= TIER_THRESHOLDS.ram.ultra && vramGB >= TIER_THRESHOLDS.vram.ultra) {
      return 'ultra'
    }
    if (ramGB >= TIER_THRESHOLDS.ram.high && vramGB >= TIER_THRESHOLDS.vram.high) {
      return 'high'
    }
    if (ramGB >= TIER_THRESHOLDS.ram.medium && vramGB >= TIER_THRESHOLDS.vram.medium) {
      return 'medium'
    }
    return 'low'
  }

  /**
   * Check if GPU acceleration is available
   */
  static hasGpuAcceleration(info: HardwareInfo): boolean {
    return info.gpu.hasCuda || info.gpu.hasMetal || info.gpu.hasVulkan
  }

  /**
   * Get recommended GPU backend
   */
  static getRecommendedGpuBackend(info: HardwareInfo): 'cuda' | 'metal' | 'vulkan' | false {
    if (info.gpu.hasCuda) return 'cuda'
    if (info.gpu.hasMetal) return 'metal'
    if (info.gpu.hasVulkan) return 'vulkan'
    return false
  }

  /**
   * Clear cached hardware info
   */
  static clearCache(): void {
    this.cachedInfo = null
    this.cacheTimestamp = 0
  }
}
