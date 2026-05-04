import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { OrderCard } from "./OrderCard";
import { 
  ShoppingCart, 
  Search, 
  Loader2,
  MessageSquare,
  CalendarDays,
  Trash2,
  Truck,
} from "lucide-react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, addWeeks, isWithinInterval, parseISO, getDay } from "date-fns";
import { es } from "date-fns/locale";

type DateFilter = "all" | "today" | "this_week" | "next_week";
type DeliveryDayFilter = "all" | "martes" | "miercoles" | "viernes";

const DATE_FILTER_CONFIG: Record<DateFilter, { label: string }> = {
  all: { label: "Todos" },
  today: { label: "Hoy" },
  this_week: { label: "Esta semana" },
  next_week: { label: "Próxima semana" },
};

const DELIVERY_DAY_CONFIG: Record<DeliveryDayFilter, { label: string; dayNumber?: number }> = {
  all: { label: "Todos los días" },
  martes: { label: "🟢 Martes", dayNumber: 2 },
  miercoles: { label: "🔵 Miércoles", dayNumber: 3 },
  viernes: { label: "🟠 Viernes", dayNumber: 5 },
};

export default function OrdersView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [dailyReviewOpen, setDailyReviewOpen] = useState(false);
  const [deliveryDayFilter, setDeliveryDayFilter] = useState<DeliveryDayFilter>("all");

  // Calculate date ranges
  const dateRanges = useMemo(() => {
    const now = new Date();
    return {
      today: {
        start: startOfDay(now),
        end: endOfDay(now),
      },
      this_week: {
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
      },
      next_week: {
        start: startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 }),
        end: endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 }),
      },
    };
  }, []);

  // Fetch all orders
  const { data: orders, isLoading } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Realtime: refetch orders on any change
  useEffect(() => {
    const channel = supabase
      .channel("admin-orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Fetch driver config (multi-driver)
  const { data: driverConfig } = useQuery({
    queryKey: ["admin-driver-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["driver_phone", "drivers"]);
      
      if (error) throw error;
      
      const config: Record<string, any> = {};
      data?.forEach((item) => {
        config[item.key] = item.value;
      });
      return config;
    },
  });

  // Generic update mutation
  const updateOrderMutation = useMutation({
    mutationFn: async ({ orderId, updates }: { orderId: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from("orders")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      toast({ title: "Actualizado" });
    },
    onError: () => {
      toast({ title: "Error al actualizar", variant: "destructive" });
    },
  });

  // Delete order mutation
  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from("orders")
        .delete()
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      toast({ title: "Pedido eliminado" });
    },
    onError: () => {
      toast({ title: "Error al eliminar", variant: "destructive" });
    },
  });

  // Delete selected orders mutation
  const deleteSelectedMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const { error } = await supabase
        .from("orders")
        .delete()
        .in("id", orderIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      setSelectedOrders(new Set());
      toast({ title: "Pedidos eliminados" });
    },
    onError: () => {
      toast({ title: "Error al eliminar", variant: "destructive" });
    },
  });

  // Filter orders
  const filteredOrders = useMemo(() => {
    return orders?.filter((order) => {
      const matchesSearch = 
        order.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.customer_phone?.includes(searchTerm) ||
        order.order_number?.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (!matchesSearch) return false;
      if (statusFilter !== "all" && order.status !== statusFilter) return false;

      if (dateFilter !== "all") {
        const orderDate = parseISO(order.created_at);
        const range = dateRanges[dateFilter];
        if (!isWithinInterval(orderDate, { start: range.start, end: range.end })) {
          return false;
        }
      }

      // Filter by delivery day of the week
      if (deliveryDayFilter !== "all" && order.delivery_date) {
        const deliveryDate = parseISO(order.delivery_date);
        const dayNum = getDay(deliveryDate);
        const expectedDay = DELIVERY_DAY_CONFIG[deliveryDayFilter].dayNumber;
        if (dayNum !== expectedDay) return false;
      } else if (deliveryDayFilter !== "all" && !order.delivery_date) {
        return false;
      }

      return true;
    }) || [];
  }, [orders, searchTerm, statusFilter, dateFilter, dateRanges, deliveryDayFilter]);

  // Group filtered orders by delivery date for display
  const ordersByDeliveryDate = useMemo(() => {
    const groups: Record<string, typeof filteredOrders> = {};
    filteredOrders.forEach((order) => {
      if (order.delivery_date) {
        const key = format(parseISO(order.delivery_date), "EEEE d 'de' MMMM", { locale: es });
        if (!groups[key]) groups[key] = [];
        groups[key].push(order);
      } else {
        const key = "Sin fecha asignada";
        if (!groups[key]) groups[key] = [];
        groups[key].push(order);
      }
    });
    return groups;
  }, [filteredOrders]);

  // Get today's confirmed orders for daily review
  const todayConfirmedOrders = useMemo(() => {
    if (!orders) return [];
    const todayRange = dateRanges.today;
    return orders.filter((order) => {
      const orderDate = parseISO(order.created_at);
      return (
        order.status === "confirmed" &&
        isWithinInterval(orderDate, { start: todayRange.start, end: todayRange.end })
      );
    });
  }, [orders, dateRanges]);

  const handleUpdateOrder = async (orderId: string, field: string, value: any) => {
    await updateOrderMutation.mutateAsync({ orderId, updates: { [field]: value } });
  };

  const toggleExpand = (orderId: string) => {
    setExpandedOrder(expandedOrder === orderId ? null : orderId);
  };

  const toggleOrderSelection = (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const selectAllVisible = () => {
    const allIds = new Set(filteredOrders.map(o => o.id));
    setSelectedOrders(allIds);
  };

  const clearSelection = () => {
    setSelectedOrders(new Set());
  };

  const buildWhatsAppMessage = (orderList: typeof orders) => {
    if (!orderList || orderList.length === 0) return "";
    
    const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es });
    const baseUrl = window.location.origin;
    
    let message = `🚚 *ENTREGAS PARA HOY*\n📅 ${today}\n\n`;
    message += `Total: ${orderList.length} entrega(s)\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    orderList.forEach((order, index) => {
      const items = Array.isArray(order.items) 
        ? order.items.map((item: any) => `  • ${item.name} x${item.quantity}`).join('\n')
        : '  Sin productos';

      // Detect incomplete address
      const address = order.customer_address || "";
      const isAddressIncomplete = address.length < 20 || !address.includes(",");
      const addressDisplay = isAddressIncomplete ? `${address} ⚠️❓` : address;

      // Delivery time
      const deliveryTime = order.delivery_date 
        ? format(parseISO(order.delivery_date), "HH:mm")
        : "Sin hora asignada";

      message += `📦 *PEDIDO ${index + 1}: ${order.order_number}*\n`;
      message += `👤 ${order.customer_name}\n`;
      message += `📍 ${addressDisplay}\n`;
      message += `📞 ${order.customer_phone}\n`;
      message += `🕐 Hora entrega: ${deliveryTime}\n`;
      message += `\n🛒 Productos:\n${items}\n`;
      const paymentLabel = order.payment_method === 'efectivo' 
        ? 'Efectivo - COBRAR 💵' 
        : order.payment_status === 'paid' 
          ? 'Tarjeta - ✅ YA PAGADO' 
          : 'Tarjeta - ⏳ PAGO PENDIENTE';
      message += `💰 Total: $${order.total} (${paymentLabel})\n`;
      
      if (order.delivery_notes) {
        message += `📝 Notas: ${order.delivery_notes}\n`;
      }
      
      if (order.delivery_token) {
        message += `\n✅ *Confirmar entrega:*\n${baseUrl}/entrega/${order.delivery_token}\n`;
      }
      
      message += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    });

    message += `✅ ¡Buen día de entregas!`;
    return message;
  };

  const sendWhatsAppForSelected = async () => {
    if (selectedOrders.size === 0) {
      toast({ title: "Selecciona al menos un pedido", variant: "destructive" });
      return;
    }

    const driverPhone = driverConfig?.driver_phone;
    if (!driverPhone) {
      toast({ title: "Configura el número del chofer primero", variant: "destructive" });
      return;
    }

    setSendingWhatsApp(true);

    try {
      const selectedOrderData = orders?.filter(o => selectedOrders.has(o.id)) || [];
      
      if (selectedOrderData.length === 0) {
        toast({ title: "No se encontraron los pedidos seleccionados", variant: "destructive" });
        return;
      }

      const message = buildWhatsAppMessage(selectedOrderData);
      const whatsappLink = `https://wa.me/52${driverPhone}?text=${encodeURIComponent(message)}`;
      
      toast({
        title: `${selectedOrderData.length} pedido(s) listos`,
        description: "Abriendo WhatsApp...",
      });

      window.open(whatsappLink, "_blank");
      setSelectedOrders(new Set());
    } catch (error) {
      console.error("Error sending WhatsApp:", error);
      toast({ title: "Error al generar mensaje", variant: "destructive" });
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const sendDailyOrders = () => {
    const driverPhone = driverConfig?.driver_phone;
    if (!driverPhone) {
      toast({ title: "Configura el número del chofer primero", variant: "destructive" });
      return;
    }

    const message = buildWhatsAppMessage(todayConfirmedOrders);
    const whatsappLink = `https://wa.me/52${driverPhone}?text=${encodeURIComponent(message)}`;
    
    toast({
      title: `${todayConfirmedOrders.length} pedido(s) del día enviados`,
      description: "Abriendo WhatsApp...",
    });

    window.open(whatsappLink, "_blank");
    setDailyReviewOpen(false);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Pedidos
              </CardTitle>
              <CardDescription>{filteredOrders.length} pedidos encontrados</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Daily orders button */}
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setDailyReviewOpen(true)}
              >
                <Truck className="h-4 w-4" />
                Mandar pedidos del día
              </Button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-[200px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Pendientes</SelectItem>
                  <SelectItem value="new">Nuevos</SelectItem>
                  <SelectItem value="confirmed">Confirmados</SelectItem>
                  <SelectItem value="in_route">En ruta</SelectItem>
                  <SelectItem value="delivered">Entregados</SelectItem>
                  <SelectItem value="cancelled">Cancelados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date Filters */}
          <div className="flex flex-wrap gap-2 pt-2">
            <div className="flex items-center gap-1 mr-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Fecha:</span>
            </div>
            {(Object.entries(DATE_FILTER_CONFIG) as [DateFilter, { label: string }][]).map(([key, config]) => (
              <Button
                key={key}
                variant={dateFilter === key ? "default" : "outline"}
                size="sm"
                onClick={() => setDateFilter(key)}
                className="h-8"
              >
                {config.label}
                {key !== "all" && dateFilter === key && (
                  <span className="ml-1 text-xs opacity-70">
                    ({format(dateRanges[key].start, "d/M")} - {format(dateRanges[key].end, "d/M")})
                  </span>
                )}
              </Button>
            ))}
          </div>

          {/* Delivery Day Filters */}
          <div className="flex flex-wrap gap-2 pt-1">
            <div className="flex items-center gap-1 mr-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Día de entrega:</span>
            </div>
            {(Object.entries(DELIVERY_DAY_CONFIG) as [DeliveryDayFilter, { label: string }][]).map(([key, config]) => (
              <Button
                key={key}
                variant={deliveryDayFilter === key ? "default" : "outline"}
                size="sm"
                onClick={() => setDeliveryDayFilter(key)}
                className="h-8"
              >
                {config.label}
              </Button>
            ))}
          </div>

          {/* Selection controls */}
          {filteredOrders.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-4 border-t mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllVisible}
              >
                Seleccionar todos ({filteredOrders.length})
              </Button>
              {selectedOrders.size > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                  >
                    Limpiar ({selectedOrders.size})
                  </Button>
                  <Button
                    onClick={sendWhatsAppForSelected}
                    disabled={sendingWhatsApp || !driverConfig?.driver_phone}
                    className="gap-2 bg-primary hover:bg-primary/90"
                  >
                    {sendingWhatsApp ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageSquare className="h-4 w-4" />
                    )}
                    Enviar {selectedOrders.size} al chofer
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="gap-2"
                        disabled={deleteSelectedMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar ({selectedOrders.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar {selectedOrders.size} pedido(s)?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta acción no se puede deshacer. Los pedidos seleccionados serán eliminados permanentemente.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteSelectedMutation.mutate(Array.from(selectedOrders))}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
              {!driverConfig?.driver_phone && (
                <span className="text-xs text-muted-foreground">
                  ⚠️ Configura el número del chofer primero
                </span>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredOrders.length > 0 ? (
            <div className="space-y-6">
              {Object.entries(ordersByDeliveryDate).map(([dateLabel, dateOrders]) => (
                <div key={dateLabel}>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold capitalize text-primary">{dateLabel}</h3>
                    <Badge variant="secondary" className="text-xs">{dateOrders.length}</Badge>
                  </div>
                  <div className="space-y-3">
                    {dateOrders.map((order: any) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        isSelected={selectedOrders.has(order.id)}
                        isExpanded={expandedOrder === order.id}
                        onToggleSelect={(e) => toggleOrderSelection(order.id, e)}
                        onToggleExpand={() => toggleExpand(order.id)}
                        onUpdate={(field, value) => handleUpdateOrder(order.id, field, value)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay pedidos</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily Orders Review Dialog */}
      <Dialog open={dailyReviewOpen} onOpenChange={setDailyReviewOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Pedidos del día — {format(new Date(), "d 'de' MMMM", { locale: es })}
            </DialogTitle>
            <DialogDescription>
              Revisa los pedidos confirmados antes de enviarlos al chofer por WhatsApp.
            </DialogDescription>
          </DialogHeader>

          {todayConfirmedOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No hay pedidos confirmados para hoy</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayConfirmedOrders.map((order, index) => {
                const items = Array.isArray(order.items) 
                  ? order.items.map((item: any) => `${item.name} x${item.quantity}`).join(", ")
                  : "Sin productos";
                const address = order.customer_address || "";
                const isAddressIncomplete = address.length < 20 || !address.includes(",");

                return (
                  <div key={order.id} className="p-3 border rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm">#{order.order_number}</span>
                      <span className="text-sm font-semibold">${order.total}</span>
                    </div>
                    <p className="text-sm">👤 {order.customer_name}</p>
                    <p className="text-sm">
                      📍 {address} {isAddressIncomplete && <span className="text-amber-600 font-bold">⚠️ Verificar dirección</span>}
                    </p>
                    <p className="text-sm">📞 {order.customer_phone}</p>
                    <p className="text-sm text-muted-foreground">🛒 {items}</p>
                    <p className="text-xs text-muted-foreground">
                      💳 {order.payment_method === "efectivo" ? "Cobrar en efectivo" : "Ya pagado"}
                    </p>
                    {order.delivery_notes && (
                      <p className="text-xs text-muted-foreground">📝 {order.delivery_notes}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDailyReviewOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={sendDailyOrders}
              disabled={todayConfirmedOrders.length === 0 || !driverConfig?.driver_phone}
              className="gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Confirmar y enviar ({todayConfirmedOrders.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
