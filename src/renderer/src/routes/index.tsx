import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const onboardingDone = await window.config.get('onboardingCompleted')
    if (!onboardingDone) {
      throw redirect({ to: '/onboarding' })
    }
  },
  component: HomeView
})

function HomeView(): React.ReactNode {
  return <div>Hello </div>
}
