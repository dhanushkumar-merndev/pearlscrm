import Image from "next/image";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/logo.png"
            alt="Pearls Aesthetic Clinic logo"
            width={180}
            height={72}
            className="h-16 w-auto object-contain"
            priority
          />
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              Pearls Aesthetic
            </h1>
            <p className="text-sm font-medium text-primary">Clinic Library</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Authorized clinical access only
            </p>
          </div>
        </div>

        {children}
      </div>
    </main>
  );
}