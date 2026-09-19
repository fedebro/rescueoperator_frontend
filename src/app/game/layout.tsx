import { GameLayout } from '@/features/game/game-layout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <GameLayout>{children}</GameLayout>;
}
