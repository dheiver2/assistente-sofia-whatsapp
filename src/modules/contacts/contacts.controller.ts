import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { Contact } from './entities/contact.entity';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('contacts')
@UseGuards(ApiKeyGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly svc: ContactsService) {}

  @Get()
  list(@Query('sessionId') sessionId: string, @Query('tag') tag?: string, @Query('search') search?: string) {
    return this.svc.list(sessionId, tag, search);
  }

  @Post()
  upsert(@Body() body: { sessionId: string; phone: string } & Partial<Contact>) {
    const { sessionId, phone, ...patch } = body;
    return this.svc.upsert(sessionId, phone, patch);
  }

  @Put(':id/tags/:tag')
  addTag(@Param('id') id: string, @Param('tag') tag: string) { return this.svc.addTag(id, tag); }

  @Delete(':id/tags/:tag')
  removeTag(@Param('id') id: string, @Param('tag') tag: string) { return this.svc.removeTag(id, tag); }

  @Delete(':id')
  delete(@Param('id') id: string) { return this.svc.delete(id); }
}
