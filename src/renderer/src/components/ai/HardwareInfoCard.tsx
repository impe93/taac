import { type FC } from 'react'
import { Cpu, HardDrive, Monitor, AlertCircle, Loader2 } from 'lucide-react'
import { useHardwareInfo } from '@renderer/hooks/useHardware'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import type { HardwareTier } from '@main/ai/types'

interface HardwareInfoCardProps {
  className?: string
}

const tierConfig: Record<HardwareTier, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20' },
  medium: { label: 'Medium', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20' },
  high: { label: 'High', className: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20' },
  ultra: { label: 'Ultra', className: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20' }
}

const formatBytes = (bytes: number): string => {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}

const formatSpeed = (speed: number): string => {
  return `${speed.toFixed(2)} GHz`
}

const getSupportedBackends = (gpu: { hasCuda: boolean; hasMetal: boolean; hasVulkan: boolean }): string[] => {
  const backends: string[] = []
  if (gpu.hasCuda) backends.push('CUDA')
  if (gpu.hasMetal) backends.push('Metal')
  if (gpu.hasVulkan) backends.push('Vulkan')
  return backends
}

export const HardwareInfoCard: FC<HardwareInfoCardProps> = ({ className }) => {
  const { data: hardware, isLoading, error } = useHardwareInfo()

  if (isLoading) {
    return (
      <Card className={cn('animate-pulse', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Detecting Hardware...
          </CardTitle>
          <CardDescription>Analyzing your system capabilities</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={cn('border-destructive/50', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" />
            Hardware Detection Failed
          </CardTitle>
          <CardDescription>Unable to detect system hardware</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'An unknown error occurred'}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!hardware) {
    return null
  }

  const { cpu, memory, gpu, tier } = hardware
  const tierInfo = tierConfig[tier]
  const backends = getSupportedBackends(gpu)

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>System Hardware</CardTitle>
          <Badge className={tierInfo.className}>{tierInfo.label} Tier</Badge>
        </div>
        <CardDescription>Your system&apos;s AI capabilities</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* CPU */}
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <Cpu className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">CPU</p>
            <p className="text-sm text-muted-foreground">{cpu.brand}</p>
            <p className="text-xs text-muted-foreground">
              {cpu.cores} cores ({cpu.physicalCores} physical) · {formatSpeed(cpu.speed)}
            </p>
          </div>
        </div>

        {/* RAM */}
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <HardDrive className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Memory</p>
            <p className="text-sm text-muted-foreground">{formatBytes(memory.totalBytes)} total</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(memory.availableBytes)} available
            </p>
          </div>
        </div>

        {/* GPU */}
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <Monitor className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">GPU</p>
            <p className="text-sm text-muted-foreground">{gpu.name}</p>
            <p className="text-xs text-muted-foreground">
              {gpu.vramBytes ? formatBytes(gpu.vramBytes) : 'Shared memory'}
              {backends.length > 0 && ` · ${backends.join(', ')}`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
