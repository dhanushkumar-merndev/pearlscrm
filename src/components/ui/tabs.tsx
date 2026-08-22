"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

type TabDirection = "forward" | "backward" | null

interface TabsContextValue {
  direction: TabDirection
}

const TabsContext = React.createContext<TabsContextValue>({
  direction: null,
})

function Tabs({
  className,
  orientation = "horizontal",
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const isControlled = controlledValue !== undefined
  const activeValue = isControlled ? controlledValue : uncontrolledValue

  const [direction, setDirection] = React.useState<TabDirection>(null)
  const prevValueRef = React.useRef<string | undefined>(activeValue)

  useIsomorphicLayoutEffect(() => {
    const prevVal = prevValueRef.current
    if (
      rootRef.current &&
      prevVal !== undefined &&
      activeValue !== undefined &&
      prevVal !== activeValue
    ) {
      const triggers = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>(
          '[data-slot="tabs-trigger"]'
        )
      )
      const prevIdx = triggers.findIndex(
        (el) =>
          el.getAttribute("data-value") === prevVal ||
          el.getAttribute("value") === prevVal
      )
      const newIdx = triggers.findIndex(
        (el) =>
          el.getAttribute("data-value") === activeValue ||
          el.getAttribute("value") === activeValue
      )

      if (prevIdx !== -1 && newIdx !== -1) {
        setDirection(newIdx > prevIdx ? "forward" : "backward")
      }
    }
    prevValueRef.current = activeValue
  }, [activeValue])

  const handleValueChange = React.useCallback(
    (val: string) => {
      if (!isControlled) {
        setUncontrolledValue(val)
      }
      onValueChange?.(val)
    },
    [isControlled, onValueChange]
  )

  return (
    <TabsContext.Provider value={{ direction }}>
      <TabsPrimitive.Root
        ref={rootRef}
        data-slot="tabs"
        data-orientation={orientation}
        value={controlledValue}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        className={cn(
          "group/tabs flex gap-2 overflow-x-clip data-horizontal:flex-col",
          className
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsContext.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list relative inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = React.useState<{
    left: number
    top: number
    width: number
    height: number
    opacity: number
  }>({ left: 0, top: 0, width: 0, height: 0, opacity: 0 })
  const [hasPositioned, setHasPositioned] = React.useState(false)

  const updateIndicator = React.useCallback(() => {
    if (!listRef.current) return
    const activeTrigger = listRef.current.querySelector<HTMLElement>(
      'button[data-state="active"]'
    )
    if (!activeTrigger) {
      setIndicatorStyle((prev) =>
        prev.opacity === 0 ? prev : { ...prev, opacity: 0 }
      )
      return
    }

    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = activeTrigger
    setIndicatorStyle({
      left: offsetLeft,
      top: offsetTop,
      width: offsetWidth,
      height: offsetHeight,
      opacity: 1,
    })
    setHasPositioned(true)
  }, [])

  useIsomorphicLayoutEffect(() => {
    updateIndicator()
  }, [updateIndicator])

  React.useEffect(() => {
    const listEl = listRef.current
    if (!listEl) return

    // Observe tab switches
    const observer = new MutationObserver(() => {
      updateIndicator()
    })

    observer.observe(listEl, {
      attributes: true,
      attributeFilter: ["data-state", "aria-selected"],
      subtree: true,
      childList: true,
    })

    // Observe size changes
    const resizeObserver = new ResizeObserver(() => {
      updateIndicator()
    })
    resizeObserver.observe(listEl)

    window.addEventListener("resize", updateIndicator)

    // Initial update in case fonts/styles loaded
    const rafId = requestAnimationFrame(updateIndicator)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener("resize", updateIndicator)
    }
  }, [updateIndicator])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {/* Squishy spring sliding indicator pill */}
      <span
        aria-hidden="true"
        data-slot="tabs-indicator"
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-0 rounded-md",
          hasPositioned
            ? "transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none"
            : "transition-none",
          variant === "default" &&
            "bg-background shadow-xs dark:border dark:border-input/50 dark:bg-input/40",
          variant === "line" &&
            "rounded-none bg-foreground !top-auto bottom-0 !h-0.5"
        )}
        style={{
          transform: `translate3d(${indicatorStyle.left}px, ${indicatorStyle.top}px, 0)`,
          width: `${indicatorStyle.width}px`,
          height: variant === "line" ? "2px" : `${indicatorStyle.height}px`,
          opacity: indicatorStyle.opacity,
        }}
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-value={value}
      value={value}
      className={cn(
        // Tactile spring press feedback
        "active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
        "relative z-10 inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/65 transition-colors duration-200 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-active:text-foreground font-medium",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  const { direction } = React.useContext(TabsContext)

  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      data-direction={direction}
      value={value}
      className={cn(
        "flex-1 text-sm outline-none px-0.5",
        "data-[state=inactive]:hidden",
        "motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }



