import { type ReactNode, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Cpu, Package, Settings2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { ModelLibrary } from '@renderer/components/ai/ModelLibrary'
import { HardwareInfoCard } from '@renderer/components/ai/HardwareInfoCard'

export const Route = createFileRoute('/settings/ai')({
  component: AISettingsPage
})

type TabValue = 'models' | 'hardware' | 'configuration'

function AISettingsPage(): ReactNode {
  const [activeTab, setActiveTab] = useState<TabValue>('models')

  return (
    <div className="flex flex-col w-full h-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">AI Settings</h1>
        <p className="text-muted-foreground">
          Manage AI models, hardware configuration, and inference settings
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex-1 flex flex-col"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="models" className="gap-1.5">
            <Package className="size-4" />
            Models
          </TabsTrigger>
          <TabsTrigger value="hardware" className="gap-1.5">
            <Cpu className="size-4" />
            Hardware
          </TabsTrigger>
          <TabsTrigger value="configuration" className="gap-1.5">
            <Settings2 className="size-4" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="mt-6 flex-1 overflow-auto">
          <ModelLibrary />
        </TabsContent>

        <TabsContent value="hardware" className="mt-6 flex-1 overflow-auto">
          <div className="max-w-2xl space-y-6">
            <HardwareInfoCard />
            <Card>
              <CardHeader>
                <CardTitle>Hardware Recommendations</CardTitle>
                <CardDescription>Tips to optimize AI performance on your system</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Your hardware tier determines which AI models can run efficiently on your system.
                  Models are categorized by their memory and compute requirements.
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    <strong>Low tier:</strong> Small models (1-3B parameters), suitable for basic
                    tasks
                  </li>
                  <li>
                    <strong>Medium tier:</strong> Medium models (3-7B parameters), good balance of
                    speed and quality
                  </li>
                  <li>
                    <strong>High tier:</strong> Large models (7-13B parameters), better reasoning
                    capabilities
                  </li>
                  <li>
                    <strong>Ultra tier:</strong> Very large models (13B+ parameters), best quality
                    but slower
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="configuration" className="mt-6 flex-1 overflow-auto">
          <div className="max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle>AI Configuration</CardTitle>
                <CardDescription>Configure AI inference settings and preferences</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Configuration options will be available here in a future update. This will include
                  settings for:
                </p>
                <ul className="mt-3 list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Default model selection for different tasks</li>
                  <li>Inference parameters (temperature, top-p, etc.)</li>
                  <li>Context window size preferences</li>
                  <li>RAG (Retrieval Augmented Generation) settings</li>
                  <li>Model caching and memory management</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
