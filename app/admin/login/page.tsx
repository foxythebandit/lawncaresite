import LoginForm from './LoginForm'
import { staffReturnTo } from '@/lib/staff-policy'
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <LoginForm next={staffReturnTo((await searchParams).next)} />
}
