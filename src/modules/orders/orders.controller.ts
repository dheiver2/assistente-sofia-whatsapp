import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto';

/** Rotas de Pedidos. O guard global de API key já protege todas (mesmo padrão do ContactsController). */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista pedidos da sessão (filtra por status/origem/busca e ordena)' })
  list(
    @Query('sessionId') sessionId: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('take') take?: string,
  ): Promise<Order[]> {
    return this.svc.list(sessionId, { status, source, search, sort, order, take: take ? parseInt(take, 10) : undefined });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Contagem de pedidos por status (para badge/indicadores)' })
  stats(@Query('sessionId') sessionId: string): Promise<Record<string, number>> {
    return this.svc.countByStatus(sessionId);
  }

  @Get('phone/:phone')
  @ApiOperation({ summary: 'Pedidos de um cliente específico' })
  byPhone(@Query('sessionId') sessionId: string, @Param('phone') phone: string): Promise<Order[]> {
    return this.svc.findByPhone(sessionId, phone);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<Order> {
    return this.svc.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um pedido (emite notificação quando status novo)' })
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.svc.create({ ...dto, items: dto.items ?? [] });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza status/itens/notas do pedido' })
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto): Promise<Order> {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string): Promise<void> {
    return this.svc.delete(id);
  }
}
