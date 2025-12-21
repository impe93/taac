import { type FC } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import * as Icons from 'lucide-react'

const AVAILABLE_ICONS = [
  'Home',
  'Briefcase',
  'User',
  'Plane',
  'Book',
  'Coffee',
  'Heart',
  'Star',
  'Zap',
  'Target',
  'Rocket',
  'Code'
] as const

interface IconPickerProps {
  value: string
  onChange: (icon: string) => void
}

export const IconPicker: FC<IconPickerProps> = ({ value, onChange }) => {
  const SelectedIcon = (Icons[value as keyof typeof Icons] || Icons.Home) as any

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <SelectedIcon className="size-4 mr-2" />
          {value}
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-4 gap-2">
          {AVAILABLE_ICONS.map((iconName) => {
            const Icon = Icons[iconName] as any
            return (
              <Button
                key={iconName}
                variant={value === iconName ? 'default' : 'ghost'}
                size="icon"
                onClick={() => onChange(iconName)}
              >
                <Icon className="size-4" />
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
