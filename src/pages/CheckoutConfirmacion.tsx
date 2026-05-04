import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, XCircle, Clock, MessageCircle, Home } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/hooks/useCart";

const WHATSAPP_NUMBER = "5212213606464";
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_POLLS = 60; // 5 minutes max

type PaymentStatus = "polling" | "approved" | "declined" | "pending" | "error" | "timeout";

export default function CheckoutConfirmacion() {
  const { clearCart } = useCart();
  const [status, setStatus] = useState<PaymentStatus>("polling");
  const [orderNumber, setOrderNumber] = useState("");
  const [pollCount, setPollCount] = useState(0);

  const checkStatus = useCallback(async (saleToken: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("centumpay-status", {
        body: { saleToken },
      });

      if (error) {
        console.error("Status check error:", error);
        return null;
      }

      return data?.status?.toLowerCase() || "unknown";
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const saleToken = localStorage.getItem("centumpay_sale_token");
    const storedOrder = localStorage.getItem("centumpay_order_number");

    if (storedOrder) setOrderNumber(storedOrder);

    if (!saleToken) {
      setStatus("error");
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let count = 0;

    const poll = async () => {
      if (cancelled || count >= MAX_POLLS) {
        if (!cancelled && count >= MAX_POLLS) setStatus("timeout");
        return;
      }

      count++;
      setPollCount(count);
      const result = await checkStatus(saleToken);

      if (cancelled) return;

      if (result === "approved" || result === "completed" || result === "paid") {
        setStatus("approved");
        clearCart();

        // Update order payment_status in database
        const savedOrder = localStorage.getItem("centumpay_order_number");
        if (savedOrder) {
          supabase
            .from("orders")
            .update({ payment_status: "paid", status: "confirmed", updated_at: new Date().toISOString() })
            .eq("order_number", savedOrder)
            .eq("payment_status", "pending")
            .then(({ error }) => {
              if (error) console.error("Error updating payment status:", error);
            });

          // Activate any pending subscription for this user
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            await supabase
              .from("subscriptions")
              .update({ status: "active", updated_at: new Date().toISOString() })
              .eq("user_id", user.id)
              .eq("status", "pending_payment");
          }
        }

        localStorage.removeItem("centumpay_sale_token");
        localStorage.removeItem("centumpay_order_number");
        return;
      }

      if (result === "declined" || result === "rejected" || result === "failed" || result === "cancelled") {
        setStatus("declined");
        localStorage.removeItem("centumpay_sale_token");
        localStorage.removeItem("centumpay_order_number");
        return;
      }

      // Still pending, poll again
      timeoutId = setTimeout(poll, POLL_INTERVAL);
    };

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [checkStatus, clearCart]);

  return (
    <Layout>
      <div className="container py-20">
        <div className="max-w-md mx-auto text-center">
          {status === "polling" && (
            <>
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Verificando tu pago...</h1>
              <p className="text-muted-foreground mb-4">
                Estamos confirmando tu pago con CentumPay. Esto puede tomar unos segundos.
              </p>
              {orderNumber && (
                <p className="text-sm text-muted-foreground mb-6">
                  Orden: <span className="font-mono font-bold">{orderNumber}</span>
                </p>
              )}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Intento {pollCount} de {MAX_POLLS}</span>
              </div>
            </>
          )}

          {status === "approved" && (
            <>
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="h-10 w-10 text-green-600" />
              </div>
              <h1 className="text-3xl font-bold mb-2">¡Pago exitoso! 🎉</h1>
              <p className="text-muted-foreground mb-4">
                Tu pago ha sido procesado correctamente.
              </p>
              {orderNumber && (
                <p className="text-lg mb-6">
                  Número de orden: <span className="font-mono font-bold text-primary">{orderNumber}</span>
                </p>
              )}
              <Card className="mb-6 text-left">
                <CardContent className="pt-6 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Te contactaremos por WhatsApp para coordinar la entrega de tu pedido.
                    Entregas: Martes, Miércoles y Viernes de 8 a 10 AM.
                  </p>
                  <Button asChild className="w-full gap-2">
                    <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4" />
                      Contactar por WhatsApp
                    </a>
                  </Button>
                </CardContent>
              </Card>
              <Button asChild variant="outline" className="gap-2">
                <Link to="/">
                  <Home className="h-4 w-4" />
                  Volver al inicio
                </Link>
              </Button>
            </>
          )}

          {status === "declined" && (
            <>
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="h-10 w-10 text-red-600" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Pago no procesado</h1>
              <p className="text-muted-foreground mb-6">
                Tu pago no pudo ser procesado. Puedes intentar de nuevo o contactarnos.
              </p>
              <div className="flex flex-col gap-3">
                <Button asChild>
                  <Link to="/carrito">Intentar de nuevo</Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Contactar soporte
                  </a>
                </Button>
              </div>
            </>
          )}

          {(status === "error" || status === "timeout") && (
            <>
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-yellow-100 flex items-center justify-center">
                <Clock className="h-10 w-10 text-yellow-600" />
              </div>
              <h1 className="text-3xl font-bold mb-2">
                {status === "timeout" ? "Tiempo de espera agotado" : "No pudimos verificar tu pago"}
              </h1>
              <p className="text-muted-foreground mb-6">
                {status === "timeout"
                  ? "No pudimos confirmar tu pago en el tiempo esperado. Si realizaste el pago, contáctanos y lo verificaremos manualmente."
                  : "No encontramos información de pago. Si acabas de pagar, contáctanos por WhatsApp."}
              </p>
              {orderNumber && (
                <p className="text-sm text-muted-foreground mb-4">
                  Orden: <span className="font-mono font-bold">{orderNumber}</span>
                </p>
              )}
              <div className="flex flex-col gap-3">
                <Button asChild className="gap-2">
                  <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Contactar por WhatsApp
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/">Volver al inicio</Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
