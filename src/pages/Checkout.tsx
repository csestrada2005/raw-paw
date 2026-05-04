import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { 
  CreditCard, Banknote, MessageCircle, 
  ArrowLeft, Check, Loader2, AlertCircle, LogIn, UserPlus, Calendar, Dog,
  ChevronDown
} from "lucide-react";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { useCart } from "@/hooks/useCart";
import { useCoverage } from "@/hooks/useCoverage";
import { useRecommendation } from "@/hooks/useRecommendation";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { LoginDialog } from "@/components/ai/LoginDialog";
import { supabase } from "@/integrations/supabase/client";

import productoRes from "@/assets/products/producto-res.png";
import productoPollo from "@/assets/products/producto-pollo.png";

const WHATSAPP_NUMBER = "5212213606464";

const CollapsibleSection = ({ 
  title, 
  open, 
  onOpenChange, 
  children, 
  icon 
}: { 
  title: string; 
  open: boolean; 
  onOpenChange: (v: boolean) => void; 
  children: React.ReactNode;
  icon?: React.ReactNode;
}) => (
  <Collapsible open={open}>
    <Card>
      <div 
        role="button"
        tabIndex={0}
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) onOpenChange(!open);
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {icon}
              {title}
            </span>
            <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          </CardTitle>
        </CardHeader>
      </div>
      <CollapsibleContent>
        <CardContent className="space-y-4 pt-0" onClick={(e) => e.stopPropagation()}>
          {children}
        </CardContent>
      </CollapsibleContent>
    </Card>
  </Collapsible>
);

const checkoutSchema = z.object({
  family_name: z.string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres"),
  email: z.string().email("Correo electrónico inválido"),
  phone: z.string()
    .regex(/^[0-9+ ()-]{7,20}$/, "Formato de teléfono inválido (7-20 dígitos)"),
  address: z.string()
    .min(5, "La dirección debe tener al menos 5 caracteres")
    .max(500, "La dirección no puede exceder 500 caracteres"),
  colonia: z.string().min(3, "La colonia debe tener al menos 3 caracteres").max(200, "La colonia no puede exceder 200 caracteres"),
  postal_code: z.string().optional().or(z.literal("")),
  references_notes: z.string().max(500).optional().or(z.literal("")),
  special_notes: z.string().max(1000).optional().or(z.literal("")),
  deliveryWindow: z.enum(["8", "9", "10"], { required_error: "Selecciona una ventana horaria" }),
  preferredDeliveryDay: z.enum(["", "tuesday", "wednesday", "friday"]).optional(),
});

const sanitizeForWhatsApp = (text: string): string => {
  return text.replace(/[<>]/g, "").replace(/[\r\n]+/g, " ").trim();
};

const paymentMethods = [
  {
    id: "efectivo",
    name: "Efectivo",
    description: "Pago al recibir tu pedido",
    icon: Banknote,
    color: "text-green-600",
  },
  {
    id: "tarjeta",
    name: "Tarjeta de crédito/débito",
    description: "Pago seguro con CentumPay",
    icon: CreditCard,
    color: "text-purple-600",
  },
];

export default function Checkout() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items, getSubtotal, clearCart } = useCart();
  const { isConfirmed, zoneName, address: coverageAddress, deliveryFee } = useCoverage();
  const { recommendation } = useRecommendation();
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; percent: number } | null>(null);
  const [discountError, setDiscountError] = useState("");
  
  // Collapsible section states
  const [contactOpen, setContactOpen] = useState(true);
  const [addressOpen, setAddressOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  
  const hasSubscription = items.some(i => i.isSubscription);
  const subscriptionItem = items.find(i => i.isSubscription);
  const dogName = subscriptionItem?.subscriptionDetails?.dogName || recommendation?.petName || "";

  const [formData, setFormData] = useState({
    family_name: "",
    email: "",
    phone: "",
    address: coverageAddress || "",
    colonia: "",
    postal_code: "",
    references_notes: "",
    special_notes: "",
    deliveryWindow: "" as "" | "8" | "9" | "10",
    preferredDeliveryDay: "" as "" | "tuesday" | "wednesday" | "friday",
  });

  // Pre-fill from profile when available
  useEffect(() => {
    if (profile) {
      setFormData(prev => ({
        ...prev,
        family_name: prev.family_name || profile.family_name || "",
        email: prev.email || profile.email || "",
        phone: prev.phone || profile.phone || "",
        address: prev.address || profile.address || "",
        colonia: prev.colonia || profile.colonia || "",
        postal_code: prev.postal_code || profile.postal_code || "",
        references_notes: prev.references_notes || profile.references_notes || "",
        special_notes: prev.special_notes || profile.special_notes || "",
      }));
    }
  }, [profile]);

  // Block subscription checkout for unauthenticated users
  useEffect(() => {
    if (!authLoading && !isAuthenticated && hasSubscription) {
      setShowLoginDialog(true);
    }
  }, [authLoading, isAuthenticated, hasSubscription]);

  // Handle redirect outside render
  useEffect(() => {
    if (shouldRedirect) {
      navigate("/carrito");
    }
  }, [shouldRedirect, navigate]);

  const getProductImage = (itemName: string) => {
    const nameLower = itemName.toLowerCase();
    if (nameLower.includes("res") || nameLower.includes("beef")) return productoRes;
    if (nameLower.includes("pollo") || nameLower.includes("chicken")) return productoPollo;
    return productoRes;
  };

  const subtotal = getSubtotal();
  const discountAmount = appliedDiscount ? Math.round(subtotal * (appliedDiscount.percent / 100)) : 0;
  const total = subtotal - discountAmount + (isConfirmed ? deliveryFee : 0);

  const VALID_CODES: Record<string, number> = {
    "PRUEBA123456PRUEBA": 99,
    "BIENVENIDO15": 15,
  };

  const handleApplyDiscount = () => {
    const code = discountCode.trim().toUpperCase();
    if (!code) return;
    const percent = VALID_CODES[code];
    if (percent) {
      setAppliedDiscount({ code, percent });
      setDiscountError("");
    } else {
      setDiscountError("Código inválido");
      setAppliedDiscount(null);
    }
  };

  const generateOrderNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `RP-${timestamp}-${random}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validationResult = checkoutSchema.safeParse(formData);
    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      toast({ title: "Error de validación", description: firstError.message, variant: "destructive" });
      return;
    }

    if (!isConfirmed) {
      toast({ title: "Verifica tu cobertura", description: "Necesitas confirmar que entregamos en tu zona.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    const newOrderNumber = generateOrderNumber();
    
    try {
      // Build delivery_date from preferred day + delivery window hour
      let deliveryDate: string | null = null;
      if (formData.deliveryWindow) {
        const hour = parseInt(formData.deliveryWindow, 10);
        const dayMap: Record<string, number> = { tuesday: 2, wednesday: 3, friday: 5 };
        const now = new Date();
        let targetDate = new Date(now);
        
        if (formData.preferredDeliveryDay && dayMap[formData.preferredDeliveryDay] !== undefined) {
          const targetDay = dayMap[formData.preferredDeliveryDay];
          const currentDay = now.getDay();
          let daysAhead = targetDay - currentDay;
          if (daysAhead <= 0) daysAhead += 7;
          targetDate.setDate(now.getDate() + daysAhead);
        }
        
        targetDate.setHours(hour, 0, 0, 0);
        deliveryDate = targetDate.toISOString();
      }

      const orderPayload: any = {
        order_number: newOrderNumber,
        customer_name: formData.family_name,
        customer_phone: formData.phone,
        customer_address: [formData.address, formData.colonia ? `Col. ${formData.colonia}` : "", formData.postal_code ? `CP ${formData.postal_code}` : ""].filter(Boolean).join(", "),
        delivery_notes: [formData.references_notes, formData.special_notes].filter(Boolean).join(" | ") || null,
        delivery_date: deliveryDate,
        items: items as any,
        subtotal,
        delivery_fee: deliveryFee,
        total,
        payment_method: paymentMethod,
        payment_status: "pending",
        status: "new",
        ai_recommendation: recommendation as any,
        order_type: hasSubscription ? "subscription" : "single",
      };

      // Only set user_id if authenticated
      if (isAuthenticated && user?.id) {
        orderPayload.user_id = user.id;
      }

      const result = isAuthenticated
        ? await supabase.from("orders").insert(orderPayload).select().single()
        : await supabase.from("orders").insert(orderPayload);
      
      if (result.error) throw result.error;

      const insertedOrder: any = (result as any).data;

      // ── Create subscription record (only for authenticated users with subscription items) ──
      if (isAuthenticated && user?.id && hasSubscription && subscriptionItem?.subscriptionDetails) {
        try {
          const sd = subscriptionItem.subscriptionDetails;
          // Check if user already has an active subscription (no unique constraint exists)
          const { data: existingActive } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("user_id", user.id)
            .eq("status", "active")
            .maybeSingle();

          if (!existingActive) {
            const freqDays = sd.frequency === "weekly" ? 7 : sd.frequency === "biweekly" ? 14 : 7;
            const nextDelivery = deliveryDate ? new Date(deliveryDate) : new Date();
            const nextBilling = new Date(nextDelivery);
            nextBilling.setMonth(nextBilling.getMonth() + (sd.planType === "annual" ? 12 : 1));

            await supabase.from("subscriptions").insert({
              user_id: user.id,
              plan_type: sd.planType,
              protein_line: sd.proteinLine,
              presentation: sd.presentation,
              frequency: sd.frequency,
              frequency_days: freqDays,
              weekly_amount_kg: sd.weeklyKg || 0,
              discount_percent: sd.discountPercent || 0,
              payment_method: paymentMethod,
              status: paymentMethod === "tarjeta" ? "pending_payment" : "active",
              next_delivery_date: nextDelivery.toISOString().split("T")[0],
              next_billing_date: nextBilling.toISOString().split("T")[0],
            });
          }
        } catch (subErr) {
          console.error("Error creating subscription record:", subErr);
        }
      }

      setOrderNumber(newOrderNumber);

      // Send order confirmation email
      if (formData.email) {
        supabase.functions.invoke("send-order-email", {
          body: {
            email: formData.email,
            familyName: formData.family_name,
            orderNumber: newOrderNumber,
            items: items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price * i.quantity })),
            total,
            paymentMethod,
            deliveryAddress: [formData.address, formData.colonia ? `Col. ${formData.colonia}` : ""].filter(Boolean).join(", "),
          },
        }).catch(err => console.error("Error sending order email:", err));
      }

      // Sync to Google Sheets
      const petInfo = dogName || (recommendation?.breed 
        ? `${recommendation.breed}${recommendation?.weight ? ` - ${recommendation.weight}kg` : ""}`
        : "");

      supabase.functions.invoke("sync-to-sheets", {
        body: {
          order_number: newOrderNumber,
          created_at: new Date().toISOString(),
          customer_name: formData.family_name,
          customer_phone: formData.phone,
          customer_address: [formData.address, formData.colonia ? `Col. ${formData.colonia}` : "", formData.postal_code ? `CP ${formData.postal_code}` : ""].filter(Boolean).join(", "),
          items,
          subtotal,
          delivery_fee: deliveryFee,
          total,
          payment_method: paymentMethod,
          order_type: hasSubscription ? "subscription" : "single",
          pet_info: petInfo,
          delivery_notes: formData.references_notes || "",
        },
      }).then(({ error }) => {
        if (error) console.error("Error syncing to sheets:", error);
      });

      // ── CentumPay flow (tarjeta) ──
      if (paymentMethod === "tarjeta") {
        const { data: cpData, error: cpError } = await supabase.functions.invoke("centumpay-checkout", {
          body: {
            items: items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price })),
            total,
            subtotal,
            discount: discountAmount,
            orderNumber: newOrderNumber,
            customerEmail: formData.email,
            customerName: formData.family_name,
          },
        });

        if (cpError || cpData?.error) {
          toast({
            title: "Error de pago",
            description: cpData?.error || "No se pudo conectar con CentumPay. Intenta de nuevo.",
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }

        // Store sale token for confirmation page polling
        if (cpData.saleToken) {
          localStorage.setItem("centumpay_sale_token", cpData.saleToken);
          localStorage.setItem("centumpay_order_number", newOrderNumber);
        }

        // Open CentumPay in new tab; navigate current window to confirmation (polling fallback)
        window.open(cpData.checkoutUrl, "_blank");
        navigate("/checkout/confirmacion");
        return;
      }

      // ── Cash/WhatsApp flow (efectivo) ──
      const sanitizedName = sanitizeForWhatsApp(formData.family_name);
      const fullAddress = [formData.address, formData.colonia ? `Col. ${formData.colonia}` : "", formData.postal_code ? `CP ${formData.postal_code}` : ""].filter(Boolean).join(", ");
      const sanitizedAddress = sanitizeForWhatsApp(fullAddress);
      const itemsList = items.map(i => `• ${sanitizeForWhatsApp(i.name)} x${i.quantity} - $${(i.price * i.quantity).toLocaleString("es-MX")}`).join("\n");
      
      const message = encodeURIComponent(
        `*Nuevo Pedido Raw Paw*\n` +
        `ID: ${newOrderNumber}\n\n` +
        `*Productos:*\n${itemsList}\n\n` +
        `*Total:* $${total.toLocaleString("es-MX")}\n` +
        `*Pago:* ${paymentMethod === "efectivo" ? "Efectivo por cobrar" : "Tarjeta"}\n\n` +
        (dogName ? `*Perrito:* ${dogName}\n` : "") +
        `*Cliente:* Fam. ${sanitizedName}\n` +
        `*Tel:* ${formData.phone}\n` +
        `*Dirección:* ${sanitizedAddress}\n` +
        (formData.references_notes ? `*Referencias:* ${sanitizeForWhatsApp(formData.references_notes)}\n` : "") +
        (formData.deliveryWindow ? `*Ventana horaria:* ${formData.deliveryWindow}:00 AM\n` : "") +
        (formData.preferredDeliveryDay ? `*Día preferido:* ${formData.preferredDeliveryDay === "tuesday" ? "Martes" : formData.preferredDeliveryDay === "wednesday" ? "Miércoles" : "Viernes"}\n` : "") +
        `\n*Entrega:* Mar/Mié/Vie 8-10 AM`
      );
      
      window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, "_blank");
      
      setOrderComplete(true);
      clearCart();
    } catch (error) {
      console.error("Error creating order:", error);
      toast({ title: "Error al crear pedido", description: "Intenta de nuevo o contáctanos por WhatsApp.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (items.length === 0 && !orderComplete) {
    // Use effect-based redirect instead of render-phase navigate
    if (!shouldRedirect) {
      setShouldRedirect(true);
    }
    return null;
  }

  if (orderComplete) {
    return (
      <Layout>
        <div className="container py-20">
          <div className="max-w-md mx-auto text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-10 w-10 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold mb-2">¡Pedido recibido!</h1>
            <p className="text-muted-foreground mb-4">Tu número de orden es:</p>
            <p className="text-2xl font-mono font-bold text-primary mb-6">{orderNumber}</p>
            
            <Card className="mb-6 text-left">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-4">
                  {paymentMethod === "efectivo" 
                    ? "Tu pedido ha sido enviado por WhatsApp. Te contactaremos para coordinar la entrega y cobro."
                    : "Tu pedido ha sido registrado. Te contactaremos para confirmar."
                  }
                </p>
                <Button asChild className="w-full gap-2">
                  <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Abrir WhatsApp
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Button asChild variant="outline">
              <Link to="/">Volver al inicio</Link>
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-12">
        <div className="max-w-4xl mx-auto">
          <Button asChild variant="ghost" className="mb-6 gap-2">
            <Link to="/carrito">
              <ArrowLeft className="h-4 w-4" />
              Volver al carrito
            </Link>
          </Button>

          <h1 className="text-3xl font-bold mb-8">Checkout</h1>

          {/* Guest suggestion (non-blocking for non-subscription) */}
          {!authLoading && !isAuthenticated && !hasSubscription && (
            <Card className="mb-6 border-primary/30 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-center sm:text-left">
                    <p className="font-medium">¿Ya has comprado antes?</p>
                    <p className="text-sm text-muted-foreground">Inicia sesión para acceder a tus datos guardados</p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm" className="gap-2">
                      <Link to="/login"><LogIn className="h-4 w-4" />Iniciar Sesión</Link>
                    </Button>
                    <Button asChild size="sm" className="gap-2">
                      <Link to="/registro"><UserPlus className="h-4 w-4" />Crear Cuenta</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!isConfirmed && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Necesitas verificar tu cobertura antes de continuar.{" "}
                <Link to="/cobertura?from=checkout" className="underline font-medium">Verificar ahora</Link>
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-4">
                {/* Perrito (for subscriptions) - NOT collapsible */}
                {hasSubscription && dogName && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Dog className="h-5 w-5 text-primary" />
                        Perrito
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-xl">
                        <span className="text-2xl">🐶</span>
                        <span className="font-semibold">{dogName}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Contact info - Collapsible */}
                <CollapsibleSection title="Contacto" open={contactOpen} onOpenChange={setContactOpen}>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="family_name">Apellido de la Familia *</Label>
                      <Input
                        id="family_name"
                        placeholder="Tu apellido"
                        value={formData.family_name}
                        onChange={(e) => setFormData({ ...formData, family_name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="tu@correo.com"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Teléfono WhatsApp *</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="221 360 6464"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      required
                    />
                  </div>
                </CollapsibleSection>

                {/* Address - Collapsible */}
                <CollapsibleSection title="Dirección de Entrega" open={addressOpen} onOpenChange={setAddressOpen}>
                  <div className="space-y-2">
                    <Label htmlFor="address">Dirección *</Label>
                    <Input
                      id="address"
                      placeholder="Calle y número"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      required
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="colonia">Colonia</Label>
                      <Input
                        id="colonia"
                        placeholder="Colonia"
                        value={formData.colonia}
                        onChange={(e) => setFormData({ ...formData, colonia: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="postal_code">Código Postal</Label>
                      <Input
                        id="postal_code"
                        placeholder="72000"
                        value={formData.postal_code}
                        onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="references_notes">Referencias (opcional)</Label>
                      <Input
                        id="references_notes"
                        placeholder="Casa azul, junto al parque..."
                        value={formData.references_notes}
                        onChange={(e) => setFormData({ ...formData, references_notes: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="special_notes">Notas especiales (opcional)</Label>
                      <Input
                        id="special_notes"
                        placeholder="Instrucciones adicionales..."
                        value={formData.special_notes}
                        onChange={(e) => setFormData({ ...formData, special_notes: e.target.value })}
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Delivery preferences - Collapsible */}
                <CollapsibleSection title="Preferencias de Entrega" open={deliveryOpen} onOpenChange={setDeliveryOpen}>
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      Ventana horaria <span className="text-destructive">*</span>
                    </Label>
                    <RadioGroup
                      value={formData.deliveryWindow}
                      onValueChange={(v) => setFormData({ ...formData, deliveryWindow: v as "8" | "9" | "10" })}
                      className="flex flex-wrap gap-4"
                    >
                      {["8", "9", "10"].map((hour) => (
                        <div key={hour} className="flex items-center space-x-2">
                          <RadioGroupItem value={hour} id={`window-${hour}`} />
                          <Label htmlFor={`window-${hour}`} className="cursor-pointer font-normal">{hour}:00 AM</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      Día de entrega preferencial
                    </Label>
                    <RadioGroup
                      value={formData.preferredDeliveryDay}
                      onValueChange={(v) => setFormData({ ...formData, preferredDeliveryDay: v as "tuesday" | "wednesday" | "friday" })}
                      className="flex flex-wrap gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="tuesday" id="delivery-tuesday" />
                        <Label htmlFor="delivery-tuesday" className="cursor-pointer font-normal">Martes</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="wednesday" id="delivery-wednesday" />
                        <Label htmlFor="delivery-wednesday" className="cursor-pointer font-normal">Miércoles</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="friday" id="delivery-friday" />
                        <Label htmlFor="delivery-friday" className="cursor-pointer font-normal">Viernes</Label>
                      </div>
                    </RadioGroup>
                    <p className="text-xs text-muted-foreground">
                      Días de entrega: Martes, Miércoles y Viernes de 8 a 10 AM
                    </p>
                  </div>
                </CollapsibleSection>

                {/* Payment method - Collapsible */}
                <CollapsibleSection title="Método de pago" open={paymentOpen} onOpenChange={setPaymentOpen}>
                  <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod} className="space-y-3">
                    {paymentMethods.map((method) => (
                      <div key={method.id} className="relative">
                        <RadioGroupItem value={method.id} id={method.id} className="peer sr-only" />
                        <Label
                          htmlFor={method.id}
                          className={`flex items-center gap-4 rounded-lg border-2 p-4 transition-colors cursor-pointer hover:bg-accent
                            peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5`}
                        >
                          <div className={`p-2 rounded-lg bg-muted ${method.color}`}>
                            <method.icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <p className="font-medium">{method.name}</p>
                            <p className="text-sm text-muted-foreground">{method.description}</p>
                          </div>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </CollapsibleSection>
              </div>

              {/* Order summary */}
              <div className="lg:col-span-1">
                <Card className="sticky top-24">
                  <CardHeader>
                    <CardTitle>Tu pedido</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 text-sm">
                        <img 
                          src={getProductImage(item.name)} 
                          alt={item.name}
                          className="h-10 w-10 rounded-lg object-cover bg-secondary/30"
                        />
                        <div className="flex-1">
                          <span className="font-medium">{item.name}</span>
                          <span className="text-muted-foreground ml-1">x{item.quantity}</span>
                        </div>
                        <span className="font-medium">${(item.price * item.quantity).toLocaleString("es-MX")}</span>
                      </div>
                    ))}
                    
                    <Separator />
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>${subtotal.toLocaleString("es-MX")}</span>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Envío</span>
                      <span>
                        {!isConfirmed ? (
                          <span className="text-muted-foreground">Verifica cobertura</span>
                        ) : deliveryFee === 0 ? (
                          <span className="text-green-600">Gratis</span>
                        ) : (
                          `$${deliveryFee.toLocaleString("es-MX")}`
                        )}
                      </span>
                    </div>
                    
                    {/* Discount code */}
                    <div className="space-y-2">
                      <Label htmlFor="discount-code" className="text-sm text-muted-foreground">Código de descuento</Label>
                      <div className="flex gap-2">
                        <Input
                          id="discount-code"
                          placeholder="Ingresa tu código"
                          value={discountCode}
                          onChange={(e) => { setDiscountCode(e.target.value); setDiscountError(""); }}
                          className="h-9 text-sm"
                        />
                        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={handleApplyDiscount}>
                          Aplicar
                        </Button>
                      </div>
                      {discountError && <p className="text-xs text-destructive">{discountError}</p>}
                      {appliedDiscount && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-primary font-medium">🎉 -{appliedDiscount.percent}% ({appliedDiscount.code})</span>
                          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setAppliedDiscount(null); setDiscountCode(""); }}>Quitar</button>
                        </div>
                      )}
                    </div>

                    {appliedDiscount && (
                      <div className="flex justify-between text-sm">
                        <span className="text-primary">Descuento</span>
                        <span className="text-primary font-medium">-${discountAmount.toLocaleString("es-MX")}</span>
                      </div>
                    )}

                    <Separator />
                    
                    <div className="flex justify-between font-bold text-lg">
                      <span>Total</span>
                      <span className="text-primary">${total.toLocaleString("es-MX")}</span>
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full gap-2"
                      disabled={isSubmitting || !isConfirmed}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Procesando...
                        </>
                      ) : paymentMethod === "tarjeta" ? (
                        <>
                          <CreditCard className="h-4 w-4" />
                          Pagar con Tarjeta
                        </>
                      ) : (
                        <>
                          <MessageCircle className="h-4 w-4" />
                          Confirmar por WhatsApp
                        </>
                      )}
                    </Button>
                    
                    <p className="text-xs text-center text-muted-foreground">
                      {paymentMethod === "tarjeta"
                        ? "Serás redirigido a CentumPay para completar tu pago de forma segura"
                        : "Al confirmar, te redirigiremos a WhatsApp para finalizar tu pedido"}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Login Dialog for subscription checkout */}
      <LoginDialog
        open={showLoginDialog}
        onOpenChange={(open) => {
          setShowLoginDialog(open);
          // If closing without logging in and has subscription, redirect to cart
          if (!open && !isAuthenticated && hasSubscription) {
            toast({
              title: "Registro requerido",
              description: "Necesitas una cuenta para comprar una suscripción.",
              variant: "destructive",
            });
            navigate("/carrito");
          }
        }}
        title="Regístrate para suscribirte"
        description="Para comprar una suscripción, primero necesitas una cuenta Raw Paw."
      />
    </Layout>
  );
}
