import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const specifications = [
  {
    category: "Audio",
    specs: [
      { label: "Driver Size", value: "40mm Dynamic" },
      { label: "Frequency Response", value: "20Hz - 20kHz" },
      { label: "Impedance", value: "32 Ohms" },
      { label: "Sensitivity", value: "105dB SPL" },
    ],
  },
  {
    category: "Connectivity",
    specs: [
      { label: "Bluetooth Version", value: "5.0" },
      { label: "Wireless Range", value: "Up to 30ft (10m)" },
      { label: "Codecs Supported", value: "SBC, AAC, aptX" },
      { label: "Multipoint Connection", value: "Yes (2 devices)" },
    ],
  },
  {
    category: "Battery & Charging",
    specs: [
      { label: "Battery Life", value: "30 hours (ANC on)" },
      { label: "Charging Time", value: "2 hours (full charge)" },
      { label: "Quick Charge", value: "15 min = 3 hours playback" },
      { label: "Charging Port", value: "USB-C" },
    ],
  },
  {
    category: "Physical",
    specs: [
      { label: "Weight", value: "250g (8.8 oz)" },
      { label: "Dimensions", value: "7.1 x 6.7 x 3.2 inches" },
      { label: "Foldable", value: "Yes" },
      { label: "Cable Length", value: "1.2m (3.9ft)" },
    ],
  },
]

export function ProductSpecs() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-heading font-bold">Technical Specifications</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {specifications.map((category) => (
          <Card key={category.category}>
            <CardHeader>
              <CardTitle className="text-lg">{category.category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {category.specs.map((spec) => (
                  <div
                    key={spec.label}
                    className="flex justify-between items-center py-2 border-b border-border last:border-b-0"
                  >
                    <span className="text-sm text-muted-foreground">{spec.label}</span>
                    <span className="text-sm font-medium">{spec.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
