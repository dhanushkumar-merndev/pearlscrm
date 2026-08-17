import { Stethoscope } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-md">
            <Stethoscope className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">AURA Clinical Data Library</h1>
            <p className="text-muted-foreground text-sm">Authorized clinical access only</p>
          </div>
        </div>

        {children}
      </div>
    </main>
  );
}
