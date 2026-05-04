import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Package, 
  Users, 
  Truck, 
  DollarSign,
  TrendingUp,
  ShoppingCart,
  Dog,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, parseISO, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, getDay } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

const STATUS_COLORS = {
  new: "#3b82f6",
  confirmed: "#eab308",
  in_route: "#a855f7",
  delivered: "#22c55e",
  cancelled: "#ef4444",
};

import { DeliveryCalendar } from "./DeliveryCalendar";

export default function DashboardView() {
  const queryClient = useQueryClient();

  // Realtime: refetch on changes
  useEffect(() => {
    const channel = supabase
      .channel("admin-dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-all-orders"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-all-subscriptions"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Fetch all orders
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["admin-all-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all profiles
  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ["admin-all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all subscriptions
  const { data: subscriptions, isLoading: subsLoading } = useQuery({
    queryKey: ["admin-all-subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all dog profiles
  const { data: dogs, isLoading: dogsLoading } = useQuery({
    queryKey: ["admin-all-dogs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dog_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = ordersLoading || profilesLoading || subsLoading || dogsLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Calculate metrics
  const totalRevenue = orders?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;
  const thisMonthOrders = orders?.filter(o => {
    const orderDate = new Date(o.created_at);
    const now = new Date();
    return orderDate >= startOfMonth(now) && orderDate <= endOfMonth(now);
  }) || [];
  const thisMonthRevenue = thisMonthOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  
  const lastMonthOrders = orders?.filter(o => {
    const orderDate = new Date(o.created_at);
    const lastMonth = subMonths(new Date(), 1);
    return orderDate >= startOfMonth(lastMonth) && orderDate <= endOfMonth(lastMonth);
  }) || [];
  const lastMonthRevenue = lastMonthOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  const revenueChange = lastMonthRevenue > 0 
    ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
    : 0;

  const activeSubscriptions = subscriptions?.filter(s => s.status === "active") || [];
  const activeDogs = dogs?.filter(d => d.status === "active") || [];

  // Order status distribution
  const statusDistribution = orders?.reduce((acc, order) => {
    const status = order.status || "new";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const pieData = Object.entries(statusDistribution).map(([name, value]) => ({
    name: name === "new" ? "Nuevos" :
          name === "confirmed" ? "Confirmados" :
          name === "in_route" ? "En ruta" :
          name === "delivered" ? "Entregados" : "Cancelados",
    value,
    color: STATUS_COLORS[name as keyof typeof STATUS_COLORS] || "#9ca3af",
  }));

  // Monthly revenue chart
  const monthlyRevenue = orders?.reduce((acc, order) => {
    const month = format(new Date(order.created_at), "MMM yy", { locale: es });
    if (!acc[month]) acc[month] = { month, revenue: 0, orders: 0 };
    acc[month].revenue += order.total || 0;
    acc[month].orders += 1;
    return acc;
  }, {} as Record<string, { month: string; revenue: number; orders: number }>) || {};

  const revenueChartData = Object.values(monthlyRevenue).slice(-12);

  // Recent activity
  const recentOrders = orders?.slice(0, 5) || [];
  const recentProfiles = profiles?.slice(0, 5) || [];

  // Driver confirmation stats
  const deliveredByDriver = orders?.filter(o => o.driver_status === "delivered").length || 0;
  const postponedByDriver = orders?.filter(o => o.driver_status === "postponed").length || 0;
  const failedByDriver = orders?.filter(o => o.driver_status === "failed").length || 0;

  // Pending deliveries (confirmed orders waiting to be sent to driver)
  const pendingDeliveries = orders?.filter(o => 
    o.status === "confirmed" || o.status === "new"
  ) || [];

  return (
    <div className="space-y-6">
      {/* 🔴 PENDING DELIVERIES - PROMINENT SECTION */}
      <Card className="border-2 border-primary bg-primary/5 shadow-lg">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <Truck className="h-5 w-5 animate-bounce" />
              🚨 Entregas Pendientes
            </CardTitle>
            <Badge variant="destructive" className="text-lg px-3 py-1">
              {pendingDeliveries.length}
            </Badge>
          </div>
          <CardDescription>
            Pedidos confirmados/nuevos listos para enviar al chofer — Mar/Mié/Vie 8-10 AM
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingDeliveries.length > 0 ? (
            <div className="space-y-3">
              {pendingDeliveries.slice(0, 8).map((order) => (
                <div key={order.id} className="flex items-center justify-between p-3 rounded-lg bg-card border">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${order.status === "new" ? "bg-blue-500 animate-pulse" : "bg-yellow-500"}`} />
                    <div>
                      <p className="font-mono text-sm font-bold">{order.order_number}</p>
                      <p className="text-sm text-muted-foreground">{order.customer_name} — {order.customer_address?.slice(0, 40)}...</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">${order.total}</p>
                    <Badge variant="outline" className="text-xs">
                      {order.status === "new" ? "Nuevo" : "Confirmado"}
                    </Badge>
                  </div>
                </div>
              ))}
              {pendingDeliveries.length > 8 && (
                <p className="text-sm text-muted-foreground text-center">
                  +{pendingDeliveries.length - 8} más...
                </p>
              )}
              <p className="text-xs text-muted-foreground text-center pt-2">
                👉 Ve a <strong>Pedidos</strong> para seleccionar y enviar al chofer por WhatsApp
              </p>
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <CheckCircle className="h-10 w-10 mx-auto mb-2 text-green-500" />
              <p className="font-medium">¡Todo al día! No hay entregas pendientes.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 📅 DELIVERY CALENDAR */}
      <DeliveryCalendar orders={orders || []} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Ventas Totales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalRevenue.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{orders?.length} pedidos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Este Mes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${thisMonthRevenue.toLocaleString()}</p>
            <p className={`text-xs ${Number(revenueChange) >= 0 ? "text-green-600" : "text-red-600"}`}>
              {Number(revenueChange) >= 0 ? "+" : ""}{revenueChange}% vs mes anterior
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" />
              Clientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{profiles?.length || 0}</p>
            <p className="text-xs text-muted-foreground">registrados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <Package className="h-3 w-3" />
              Suscripciones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activeSubscriptions.length}</p>
            <p className="text-xs text-muted-foreground">activas de {subscriptions?.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <Dog className="h-3 w-3" />
              Perritos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activeDogs.length}</p>
            <p className="text-xs text-muted-foreground">perfiles activos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <Truck className="h-3 w-3" />
              Entregas Confirmadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{deliveredByDriver}</p>
            <p className="text-xs text-muted-foreground">
              {postponedByDriver} pospuestas, {failedByDriver} fallidas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ventas por Mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `$${v / 1000}k`} />
                  <Tooltip 
                    formatter={(value: number) => [`$${value.toLocaleString()}`, "Ventas"]}
                  />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Order Status Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Estado de Pedidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Orders and Activity Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Pedidos Recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between border-b pb-2">
                  <div>
                    <p className="font-mono text-sm font-medium">{order.order_number}</p>
                    <p className="text-xs text-muted-foreground">{order.customer_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">${order.total}</p>
                    <Badge 
                      variant="outline" 
                      className="text-xs"
                      style={{ 
                        backgroundColor: `${STATUS_COLORS[order.status as keyof typeof STATUS_COLORS]}20`,
                        color: STATUS_COLORS[order.status as keyof typeof STATUS_COLORS]
                      }}
                    >
                      {order.status === "new" ? "Nuevo" :
                       order.status === "confirmed" ? "Confirmado" :
                       order.status === "in_route" ? "En ruta" :
                       order.status === "delivered" ? "Entregado" : "Cancelado"}
                    </Badge>
                  </div>
                </div>
              ))}
              {recentOrders.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay pedidos aún
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Customers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4" />
              Clientes Recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentProfiles.map((profile) => (
                <div key={profile.id} className="flex items-center justify-between border-b pb-2">
                  <div>
                    <p className="font-medium text-sm">{profile.family_name}</p>
                    <p className="text-xs text-muted-foreground">{profile.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(profile.created_at), "d MMM yy", { locale: es })}
                    </p>
                    <p className="text-xs">{profile.postal_code}</p>
                  </div>
                </div>
              ))}
              {recentProfiles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay clientes aún
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Driver Status Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Resumen de Entregas (Confirmadas por Chofer)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{deliveredByDriver}</p>
                <p className="text-xs text-muted-foreground">Entregados</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Clock className="h-8 w-8 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold">{postponedByDriver}</p>
                <p className="text-xs text-muted-foreground">Pospuestos</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <XCircle className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-2xl font-bold">{failedByDriver}</p>
                <p className="text-xs text-muted-foreground">Fallidos</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <AlertCircle className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">
                  {orders?.filter(o => o.status === "in_route" && !o.driver_status).length || 0}
                </p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
