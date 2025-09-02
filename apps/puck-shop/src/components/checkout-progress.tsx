import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface Step {
  id: number
  name: string
  description: string
}

interface CheckoutProgressProps {
  steps: Step[]
  currentStep: number
  className?: string
}

export function CheckoutProgress({ steps, currentStep, className }: CheckoutProgressProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                  step.id < currentStep
                    ? "border-primary bg-primary text-primary-foreground"
                    : step.id === currentStep
                      ? "border-primary bg-background text-primary"
                      : "border-muted-foreground bg-background text-muted-foreground",
                )}
              >
                {step.id < currentStep ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-semibold">{step.id}</span>
                )}
              </div>

              {/* Step Info */}
              <div className="mt-2 text-center">
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.id <= currentStep ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.name}
                </p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "mx-4 h-0.5 w-16 transition-colors",
                  step.id < currentStep ? "bg-primary" : "bg-muted-foreground",
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
