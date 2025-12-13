import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  component: RouteComponent
})

function RouteComponent() {
  return (
    <div className="min-h-screen ">
      Dashboard Layout
      <div>
        <Outlet />
      </div>
    </div>
  )
}
