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

import si from 'systeminformation'
import type {
  HardwareInfo,
  HardwareTier,
  CPUInfo,
  MemoryInfo,
  GPUInfo,
  ModelRecommendation,
  EstimatedPerformance
} from './types'
import { ModelSelector } from './ModelSelector'

/**
 * Tier score thresholds
 * - Ultra: score >= 8 (CPU 8+ cores, RAM 32GB+, VRAM 16GB+)
 * - High: score >= 5
 * - Medium: score >= 3
 * - Low: score < 3
 */
const TIER_THRESHOLDS = {
  ultra: 8,
  high: 5,
  medium: 3
} as const

/**
 * Hardware Detector class for system capability detection
 */
export class HardwareDetector {
  private static cachedInfo: HardwareInfo | null = null

  /**
   * Detect system hardware and classify tier
   */
  static async detect(): Promise<HardwareInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo
    }

    const [cpu, mem, graphics] = await Promise.all([si.cpu(), si.mem(), si.graphics()])

    const controllers = graphics.controllers ?? []
    const primaryGpu = this.selectPrimaryGpu(controllers)

    const gpuInfo: GPUInfo = {
      // systeminformation exposes the adapter label as `model` on both macOS
      // and Windows. Keep the legacy `name` fallback for older releases.
      name: primaryGpu?.model || primaryGpu?.name || 'Unknown',
      vendor: primaryGpu?.vendor || 'Unknown',
      vramBytes: primaryGpu?.vram ? primaryGpu.vram * 1024 * 1024 : null,
      // Hybrid Windows laptops commonly report the integrated adapter first.
      // Capabilities must therefore be aggregated across every controller,
      // while memory/model details come from the preferred compute adapter.
      hasCuda: controllers.some((gpu) => this.detectCuda(gpu)),
      hasMetal: process.platform === 'darwin',
      hasVulkan: controllers.some((gpu) => this.detectVulkan(gpu)),
      driverVersion: primaryGpu?.driverVersion || null
    }

    const cpuInfo: CPUInfo = {
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speed: cpu.speed
    }

    const memoryInfo: MemoryInfo = {
      totalBytes: mem.total,
      availableBytes: mem.available
    }

    const tier = this.calculateTier(cpuInfo, memoryInfo, gpuInfo)

    this.cachedInfo = {
      cpu: cpuInfo,
      memory: memoryInfo,
      gpu: gpuInfo,
      platform: process.platform,
      tier
    }

    return this.cachedInfo
  }

  /**
   * Get model recommendations based on detected hardware tier
   */
  static async getModelRecommendations(): Promise<ModelRecommendation[]> {
    const hardware = await this.detect()
    const profile = ModelSelector.getModelProfile(hardware)
    const chatPerf: EstimatedPerformance = hardware.tier === 'low' ? 'fast' : 'very-fast'

    const recommendations: ModelRecommendation[] = [
      {
        modelId: profile.features.chat.id,
        reason: 'Compact chat model with strong reasoning and multilingual capabilities',
        estimatedPerformance: chatPerf,
        gpuLayersRecommended: -1
      },
      {
        modelId: profile.features.search.embedding.id,
        reason: 'Required for semantic search and RAG functionality',
        estimatedPerformance: 'fast',
        gpuLayersRecommended: -1
      },
      {
        modelId: profile.features.search.reranker.id,
        reason: 'Improves search relevance by re-scoring query/document pairs',
        estimatedPerformance: 'fast',
        gpuLayersRecommended: -1
      },
      {
        modelId: profile.features.meeting.whisper.id,
        reason: 'Optimal transcription model for your hardware tier',
        estimatedPerformance: 'moderate',
        gpuLayersRecommended: -1
      }
    ]

    if (profile.features.meeting.asr) {
      recommendations.push({
        modelId: profile.features.meeting.asr.id,
        reason: 'Optimal realtime transcription model for your hardware tier',
        estimatedPerformance: hardware.tier === 'low' ? 'fast' : 'moderate',
        gpuLayersRecommended: -1
      })
    }

    return recommendations
  }

  /**
   * Calculate hardware tier based on CPU, RAM, and GPU specs
   *
   * Scoring:
   * - CPU: max 2 points (8+ physical cores = 2, 4+ = 1)
   * - RAM: max 2 points (32GB+ = 2, 16GB+ = 1)
   * - VRAM: max 4 points (16GB+ = 4, 8GB+ = 3, 4GB+ = 2)
   * - Apple Silicon bonus: +2 for Metal with Apple GPU (unified memory advantage)
   */
  private static calculateTier(cpu: CPUInfo, memory: MemoryInfo, gpu: GPUInfo): HardwareTier {
    let score = 0

    // CPU scoring (max 2 points)
    if (cpu.physicalCores >= 8) {
      score += 2
    } else if (cpu.physicalCores >= 4) {
      score += 1
    }

    // RAM scoring (max 2 points)
    const ramGB = memory.totalBytes / (1024 * 1024 * 1024)
    if (ramGB >= 32) {
      score += 2
    } else if (ramGB >= 16) {
      score += 1
    }

    // GPU/VRAM scoring (max 4 points)
    if (gpu.vramBytes) {
      const vramGB = gpu.vramBytes / (1024 * 1024 * 1024)
      if (vramGB >= 16) {
        score += 4
      } else if (vramGB >= 8) {
        score += 3
      } else if (vramGB >= 4) {
        score += 2
      }
    }

    // Bonus for Apple Silicon with unified memory
    if (gpu.hasMetal && gpu.vendor.toLowerCase().includes('apple')) {
      score += 2
    }

    // Classify tier based on score
    if (score >= TIER_THRESHOLDS.ultra) return 'ultra'
    if (score >= TIER_THRESHOLDS.high) return 'high'
    if (score >= TIER_THRESHOLDS.medium) return 'medium'
    return 'low'
  }

  /**
   * Detect CUDA support (NVIDIA GPU)
   */
  private static detectCuda(gpu: si.Systeminformation.GraphicsControllerData | undefined): boolean {
    if (!gpu) return false
    return gpu.vendor?.toLowerCase().includes('nvidia') || false
  }

  /**
   * Detect Vulkan support (NVIDIA/AMD/Intel GPU)
   */
  private static detectVulkan(
    gpu: si.Systeminformation.GraphicsControllerData | undefined
  ): boolean {
    if (!gpu) return false
    // Current NVIDIA, AMD and Intel adapters generally support Vulkan.
    return (
      gpu.vendor?.toLowerCase().includes('nvidia') ||
      gpu.vendor?.toLowerCase().includes('amd') ||
      gpu.vendor?.toLowerCase().includes('intel') ||
      false
    )
  }

  /**
   * Pick the adapter whose native backend Taac will actually prefer.
   *
   * Windows often returns the low-power Intel/AMD iGPU before a discrete
   * NVIDIA GPU. Prefer CUDA-capable adapters, then Apple/AMD/Intel compute
   * adapters, using reported VRAM to break ties within the same family.
   */
  private static selectPrimaryGpu(
    controllers: si.Systeminformation.GraphicsControllerData[]
  ): si.Systeminformation.GraphicsControllerData | undefined {
    const score = (gpu: si.Systeminformation.GraphicsControllerData): number => {
      const vendor = gpu.vendor?.toLowerCase() ?? ''
      const model = (gpu.model || gpu.name || '').toLowerCase()

      let backendRank = 0
      if (vendor.includes('nvidia')) backendRank = 4
      else if (vendor.includes('apple')) backendRank = 3
      else if (vendor.includes('amd')) backendRank = 2
      else if (vendor.includes('intel')) backendRank = 1

      // Avoid preferring Windows' software fallback adapter when a real GPU is
      // also present. VRAM is in MB in systeminformation's response.
      const softwarePenalty = model.includes('microsoft basic') ? 1_000_000_000 : 0
      return backendRank * 1_000_000 + (gpu.vram ?? 0) - softwarePenalty
    }

    return controllers.reduce<si.Systeminformation.GraphicsControllerData | undefined>(
      (best, current) => (!best || score(current) > score(best) ? current : best),
      undefined
    )
  }

  /**
   * Check if GPU acceleration is available
   */
  static hasGpuAcceleration(info: HardwareInfo): boolean {
    return info.gpu.hasCuda || info.gpu.hasMetal || info.gpu.hasVulkan
  }

  /**
   * Get recommended GPU backend for the current hardware
   */
  static getRecommendedGpuBackend(info: HardwareInfo): 'cuda' | 'metal' | 'vulkan' | false {
    if (info.platform === 'darwin' && info.gpu.hasMetal) return 'metal'
    if (info.gpu.hasCuda) return 'cuda'
    if (info.gpu.hasVulkan) return 'vulkan'
    return false
  }

  /**
   * Clear cached hardware info (useful for testing)
   */
  static clearCache(): void {
    this.cachedInfo = null
  }
}
