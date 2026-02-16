import { type FC } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardDescription, CardTitle } from '@renderer/components/ui/card'

interface TutorialCardProps {
  icon: LucideIcon
  title: string
  description: string
}

export const TutorialCard: FC<TutorialCardProps> = ({ icon: Icon, title, description }) => (
  <Card className="p-6">
    <div className="mb-3 flex items-center gap-3">
      <div className="rounded-lg bg-primary/10 p-2">
        <Icon className="size-5 text-primary" />
      </div>
      <CardTitle className="text-base">{title}</CardTitle>
    </div>
    <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
  </Card>
)
